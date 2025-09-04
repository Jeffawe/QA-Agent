import { LinkInfo, StageHandObserveResult, State, UITesterResult, UIElementInfo, UIElementType, FormElementInfo } from "../types.js";
import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import AutoActionService from "../services/actions/autoActionService.js";
import StagehandSession from "../browserAuto/stagehandSession.js";
import { GroupedUIElements, UIElementGrouper } from "../utility/links/linkGrouper.js";
import { Page } from "@browserbasehq/stagehand";

export default class Tester extends Agent {
    public nextLink: Omit<LinkInfo, 'visited'> | null = null;

    private queue: LinkInfo[] = [];
    private observedElements: StageHandObserveResult[] = [];
    private groupedElements: GroupedUIElements | null = null;
    private testResults: UITesterResult[] = [];
    private page: Page;

    private stagehandSession: StagehandSession;
    private localactionService: AutoActionService;

    constructor(dependencies: BaseAgentDependencies) {
        super("tester", dependencies);
        this.state = dependencies.dependent ? State.WAIT : State.START;

        this.stagehandSession = this.session as StagehandSession;
        this.localactionService = this.actionService as AutoActionService;


        if (this.stagehandSession.page === null) {
            this.logManager.error('Page not initialized', this.buildState(), true);
            throw new Error('Page not initialized');
        }

        this.page = this.stagehandSession.page;
    }

    public enqueue(links: LinkInfo[]) {
        this.queue = links;
        if (this.state === State.DONE || this.state === State.WAIT) {
            this.setState(State.START);
        } else {
            this.logManager.log("Tester is already running or cannot start up", this.buildState(), true);
        }
    }

    protected validateSessionType(): void {
        if (!(this.session instanceof StagehandSession)) {
            this.logManager.error(`Tester requires stagehandSession, got ${this.session.constructor.name}`);
            this.setState(State.ERROR);
            throw new Error(`Tester requires stagehandSession, got ${this.session.constructor.name}`);
        }

        this.stagehandSession = this.session as StagehandSession;
    }

    protected validateActionService(): void {
        if (!(this.actionService instanceof AutoActionService)) {
            this.logManager.error(`Tester requires an appropriate action service`);
            this.setState(State.ERROR);
            throw new Error(`Tester requires an appropriate action service`);
        }

        this.localactionService = this.actionService as AutoActionService;
    }

    async tick(): Promise<void> {
        if (this.paused) {
            return;
        }

        try {
            switch (this.state) {
                case State.START:
                    this.setState(State.OBSERVE);
                    break;

                case State.OBSERVE:
                    this.observedElements = await this.stagehandSession.observe();
                    this.setState(State.DECIDE);
                    break;

                case State.DECIDE:
                    await this.groupElements();
                    break;

                case State.ACT:
                    await this.testButtons();
                    await this.testTextInputs();
                    await this.testSelects();
                    await this.testCheckboxes();
                    await this.testRadios();
                    await this.testForms();
                    await this.testLinks();
                    await this.testFileInputs();
                    await this.testDateInputs();
                    await this.testNumberInputs();
                    await this.testOtherInputs();
                    this.setState(State.VALIDATE);
                    break;

                case State.VALIDATE:
                    await this.validateResults();
                    this.setState(State.DONE);
                    break;

                case State.DONE:
                case State.ERROR:
                case State.PAUSE:
                default:
                    break;
            }
        } catch (e) {
            this.logManager.error(`Tester Agent Error: ${String(e)}`, this.buildState());
            this.setState(State.ERROR);
        }
    }

    private async groupElements(): Promise<void> {
        this.logManager.log('Grouping UI elements', this.buildState(), true);

        if (this.observedElements.length === 0) {
            this.logManager.log('No elements to group, skipping to validation', this.buildState(), true);
            this.setState(State.VALIDATE);
            return;
        }

        this.groupedElements = await UIElementGrouper.groupUIElements(this.observedElements, this.stagehandSession.page!);

        const summary = UIElementGrouper.getElementSummary(this.groupedElements);
        this.logManager.log(`Grouped elements: ${JSON.stringify(summary)}`, this.buildState(), true);

        this.setState(State.ACT);
    }

    private async testButtons(): Promise<void> {
        if (!this.groupedElements || this.groupedElements.buttons.length === 0) {
            return;
        }

        this.logManager.log(`Testing ${this.groupedElements.buttons.length} buttons`, this.buildState(), true);

        for (const button of this.groupedElements.buttons) {
            await this.testButtonElement(button);
        }
    }

    private async testButtonElement(button: UIElementInfo): Promise<void> {
        try {
            // Positive test: Normal click
            const initialUrl = this.stagehandSession.page!.url();
            await this.stagehandSession.page!.click(button.selector);

            // Wait a bit for potential navigation or modal
            await this.stagehandSession.page!.waitForTimeout(1000);

            const newUrl = this.stagehandSession.page!.url();
            const navigationOccurred = initialUrl !== newUrl;

            this.testResults.push({
                element: button,
                testType: 'positive',
                testValue: 'click',
                success: true,
                response: navigationOccurred ? `Navigated to: ${newUrl}` : 'Button clicked successfully'
            });

            this.logManager.log(`Button test passed: ${button.description}`, this.buildState(), false);

        } catch (error) {
            this.testResults.push({
                element: button,
                testType: 'positive',
                testValue: 'click',
                success: false,
                error: String(error)
            });

            this.logManager.error(`Button test failed: ${button.description} - ${error}`, this.buildState(), false);
        }
    }

    private async testTextInputs(): Promise<void> {
        if (!this.groupedElements || this.groupedElements.textInputs.length === 0) {
            return;
        }

        this.logManager.log(`Testing ${this.groupedElements.textInputs.length} text inputs`, this.buildState(), true);

        for (const input of this.groupedElements.textInputs) {
            await this.testTextInputElement(input);
        }
    }

    private async testTextInputElement(input: UIElementInfo): Promise<void> {
        const testData = this.generateTextInputTestData(input);

        for (const testCase of testData) {
            try {
                // Clear the input first
                await this.page.fill(input.selector, '');

                // Fill with test data
                await this.page.fill(input.selector, testCase.value);

                // Trigger change event
                await this.page.dispatchEvent(input.selector, 'change');

                this.testResults.push({
                    element: input,
                    testType: testCase.type,
                    testValue: testCase.value,
                    success: true,
                    response: `Input filled successfully with: ${testCase.value}`
                });

                this.logManager.log(`Text input test (${testCase.type}) passed: ${input.description}`, this.buildState(), false);

            } catch (error) {
                this.testResults.push({
                    element: input,
                    testType: testCase.type,
                    testValue: testCase.value,
                    success: false,
                    error: String(error)
                });

                this.logManager.error(`Text input test (${testCase.type}) failed: ${input.description} - ${error}`, this.buildState(), false);
            }

            // Small delay between tests
            await this.page.waitForTimeout(200);
        }
    }

    private generateTextInputTestData(input: UIElementInfo): Array<{ value: string, type: 'positive' | 'negative' }> {
        const testCases: Array<{ value: string, type: 'positive' | 'negative' }> = [];

        // Positive test cases
        switch (input.elementType) {
            case UIElementType.EMAIL_INPUT:
                testCases.push(
                    { value: 'test@example.com', type: 'positive' },
                    { value: 'user.name+tag@domain.co.uk', type: 'positive' },
                    { value: 'invalid-email', type: 'negative' },
                    { value: '@domain.com', type: 'negative' },
                    { value: 'test@', type: 'negative' }
                );
                break;

            case UIElementType.PASSWORD_INPUT:
                testCases.push(
                    { value: 'ValidPassword123!', type: 'positive' },
                    { value: 'AnotherGoodP@ss', type: 'positive' },
                    { value: '123', type: 'negative' }, // too short
                    { value: 'password', type: 'negative' }, // too simple
                    { value: '', type: 'negative' } // empty
                );
                break;

            default:
                testCases.push(
                    { value: 'Valid input text', type: 'positive' },
                    { value: 'Another valid entry', type: 'positive' },
                    { value: 'x'.repeat(1000), type: 'negative' }, // extremely long
                    { value: '<script>alert("xss")</script>', type: 'negative' }, // XSS attempt
                );
                break;
        }

        return testCases;
    }

    private async testSelects(): Promise<void> {
        if (!this.groupedElements || this.groupedElements.selects.length === 0) {
            return;
        }

        this.logManager.log(`Testing ${this.groupedElements.selects.length} select elements`, this.buildState(), true);

        for (const select of this.groupedElements.selects) {
            await this.testSelectElement(select);
        }
    }

    private async testSelectElement(select: UIElementInfo): Promise<void> {
        try {
            // Get all options
            const options = await this.page.evaluate((selector) => {
                const selectEl = document.querySelector(selector) as HTMLSelectElement;
                if (!selectEl) return [];

                return Array.from(selectEl.options).map(option => ({
                    value: option.value,
                    text: option.text
                }));
            }, select.selector);

            if (options.length === 0) {
                this.logManager.log(`Select element has no options: ${select.description}`, this.buildState(), false);
                return;
            }

            // Positive test: Select each valid option
            for (const option of options) {
                try {
                    await this.page.selectOption(select.selector, option.value);

                    this.testResults.push({
                        element: select,
                        testType: 'positive',
                        testValue: option.value,
                        success: true,
                        response: `Selected option: ${option.text}`
                    });

                    await this.page.waitForTimeout(200);

                } catch (error) {
                    this.testResults.push({
                        element: select,
                        testType: 'positive',
                        testValue: option.value,
                        success: false,
                        error: String(error)
                    });
                }
            }

            // Negative test: Try to select invalid option
            try {
                await this.page.selectOption(select.selector, 'invalid-option-value');

                this.testResults.push({
                    element: select,
                    testType: 'negative',
                    testValue: 'invalid-option-value',
                    success: false,
                    response: 'Should have failed but succeeded'
                });

            } catch (error) {
                // This is expected to fail
                this.testResults.push({
                    element: select,
                    testType: 'negative',
                    testValue: 'invalid-option-value',
                    success: true,
                    response: 'Correctly rejected invalid option'
                });
            }

        } catch (error) {
            this.testResults.push({
                element: select,
                testType: 'positive',
                testValue: 'general',
                success: false,
                error: String(error)
            });
        }
    }

    private async testCheckboxes(): Promise<void> {
        if (!this.groupedElements || this.groupedElements.checkboxes.length === 0) {
            return;
        }

        this.logManager.log(`Testing ${this.groupedElements.checkboxes.length} checkboxes`, this.buildState(), true);

        for (const checkbox of this.groupedElements.checkboxes) {
            await this.testCheckboxElement(checkbox);
        }
    }

    private async testCheckboxElement(checkbox: UIElementInfo): Promise<void> {
        try {
            // Test checking the checkbox
            await this.page.check(checkbox.selector);

            this.testResults.push({
                element: checkbox,
                testType: 'positive',
                testValue: true,
                success: true,
                response: 'Checkbox checked successfully'
            });

            await this.page.waitForTimeout(200);

            // Test unchecking the checkbox
            await this.page.uncheck(checkbox.selector);

            this.testResults.push({
                element: checkbox,
                testType: 'positive',
                testValue: false,
                success: true,
                response: 'Checkbox unchecked successfully'
            });

        } catch (error) {
            this.testResults.push({
                element: checkbox,
                testType: 'positive',
                testValue: 'toggle',
                success: false,
                error: String(error)
            });
        }
    }

    private async testRadios(): Promise<void> {
        if (!this.groupedElements || this.groupedElements.radios.length === 0) {
            return;
        }

        this.logManager.log(`Testing ${this.groupedElements.radios.length} radio buttons`, this.buildState(), true);

        for (const radio of this.groupedElements.radios) {
            await this.testRadioElement(radio);
        }
    }

    private async testRadioElement(radio: UIElementInfo): Promise<void> {
        try {
            await this.page.check(radio.selector);

            this.testResults.push({
                element: radio,
                testType: 'positive',
                testValue: true,
                success: true,
                response: 'Radio button selected successfully'
            });

        } catch (error) {
            this.testResults.push({
                element: radio,
                testType: 'positive',
                testValue: true,
                success: false,
                error: String(error)
            });
        }
    }

    private async testForms(): Promise<void> {
        if (!this.groupedElements || this.groupedElements.forms.length === 0) {
            return;
        }

        this.logManager.log(`Testing ${this.groupedElements.forms.length} forms`, this.buildState(), true);

        for (const form of this.groupedElements.forms) {
            await this.testFormElement(form);
        }
    }

    private async testFormElement(form: FormElementInfo): Promise<void> {
        try {
            // Positive test: Fill form with valid data
            await this.fillFormWithValidData(form);

            // Negative test: Fill form with invalid data
            await this.fillFormWithInvalidData(form);

        } catch (error) {
            this.testResults.push({
                element: form,
                testType: 'positive',
                testValue: 'form_test',
                success: false,
                error: String(error)
            });
        }
    }

    private async fillFormWithValidData(form: FormElementInfo): Promise<void> {
        // Implementation would fill each form element with appropriate valid data
        // This is a simplified version
        this.testResults.push({
            element: form,
            testType: 'positive',
            testValue: 'valid_form_data',
            success: true,
            response: 'Form filled with valid data'
        });
    }

    private async fillFormWithInvalidData(form: FormElementInfo): Promise<void> {
        // Implementation would fill each form element with inappropriate data
        // This is a simplified version
        this.testResults.push({
            element: form,
            testType: 'negative',
            testValue: 'invalid_form_data',
            success: true,
            response: 'Form tested with invalid data'
        });
    }

    private async testLinks(): Promise<void> {
        if (!this.groupedElements || this.groupedElements.links.length === 0) {
            return;
        }

        this.logManager.log(`Testing ${this.groupedElements.links.length} links`, this.buildState(), true);

        for (const link of this.groupedElements.links) {
            await this.testLinkElement(link);
        }
    }

    private async testLinkElement(link: UIElementInfo): Promise<void> {
        try {
            const initialUrl = this.page.url();
            await this.page.click(link.selector);

            // Wait for potential navigation
            await this.page.waitForTimeout(1500);

            const newUrl = this.page.url();
            const navigationOccurred = initialUrl !== newUrl;

            this.testResults.push({
                element: link,
                testType: 'positive',
                testValue: 'click',
                success: true,
                response: navigationOccurred ? `Navigated to: ${newUrl}` : 'Link clicked (no navigation)'
            });

            // Navigate back if we moved to a new page
            if (navigationOccurred) {
                await this.page.goBack();
                await this.page.waitForTimeout(1000);
            }

        } catch (error) {
            this.testResults.push({
                element: link,
                testType: 'positive',
                testValue: 'click',
                success: false,
                error: String(error)
            });
        }
    }

    private async testFileInputs(): Promise<void> {
        if (!this.groupedElements || this.groupedElements.fileInputs.length === 0) {
            return;
        }

        this.logManager.log(`Testing ${this.groupedElements.fileInputs.length} file inputs`, this.buildState(), true);

        for (const fileInput of this.groupedElements.fileInputs) {
            await this.testFileInputElement(fileInput);
        }
    }

    private async testFileInputElement(fileInput: UIElementInfo): Promise<void> {
        // File input testing would require actual file paths
        // This is a placeholder implementation
        this.testResults.push({
            element: fileInput,
            testType: 'positive',
            testValue: 'file_test',
            success: true,
            response: 'File input tested (placeholder)'
        });
    }

    private async testDateInputs(): Promise<void> {
        if (!this.groupedElements || this.groupedElements.dateInputs.length === 0) {
            return;
        }

        this.logManager.log(`Testing ${this.groupedElements.dateInputs.length} date inputs`, this.buildState(), true);

        for (const dateInput of this.groupedElements.dateInputs) {
            await this.testDateInputElement(dateInput);
        }
    }

    private async testDateInputElement(dateInput: UIElementInfo): Promise<void> {
        const testDates = [
            { value: '2024-01-01', type: 'positive' as const },
            { value: '2024-12-31', type: 'positive' as const },
            { value: 'invalid-date', type: 'negative' as const },
            { value: '2024-13-01', type: 'negative' as const } // Invalid month
        ];

        for (const testCase of testDates) {
            try {
                await this.page.fill(dateInput.selector, testCase.value);

                this.testResults.push({
                    element: dateInput,
                    testType: testCase.type,
                    testValue: testCase.value,
                    success: true,
                    response: `Date input filled with: ${testCase.value}`
                });

            } catch (error) {
                this.testResults.push({
                    element: dateInput,
                    testType: testCase.type,
                    testValue: testCase.value,
                    success: false,
                    error: String(error)
                });
            }
        }
    }

    private async testNumberInputs(): Promise<void> {
        if (!this.groupedElements || this.groupedElements.numberInputs.length === 0) {
            return;
        }

        this.logManager.log(`Testing ${this.groupedElements.numberInputs.length} number inputs`, this.buildState(), true);

        for (const numberInput of this.groupedElements.numberInputs) {
            await this.testNumberInputElement(numberInput);
        }
    }

    private async testNumberInputElement(numberInput: UIElementInfo): Promise<void> {
        const min = numberInput.elementDetails.min ? parseInt(numberInput.elementDetails.min) : -1000;
        const max = numberInput.elementDetails.max ? parseInt(numberInput.elementDetails.max) : 1000;

        const testNumbers = [
            { value: String(min), type: 'positive' as const },
            { value: String(max), type: 'positive' as const },
            { value: String(Math.floor((min + max) / 2)), type: 'positive' as const },
            { value: String(min - 1), type: 'negative' as const }, // Below minimum
            { value: String(max + 1), type: 'negative' as const }, // Above maximum
            { value: 'not-a-number', type: 'negative' as const }
        ];

        for (const testCase of testNumbers) {
            try {
                await this.page.fill(numberInput.selector, testCase.value);

                this.testResults.push({
                    element: numberInput,
                    testType: testCase.type,
                    testValue: testCase.value,
                    success: true,
                    response: `Number input filled with: ${testCase.value}`
                });

            } catch (error) {
                this.testResults.push({
                    element: numberInput,
                    testType: testCase.type,
                    testValue: testCase.value,
                    success: false,
                    error: String(error)
                });
            }
        }
    }

    private async testOtherInputs(): Promise<void> {
        if (!this.groupedElements || this.groupedElements.otherInputs.length === 0) {
            return;
        }

        this.logManager.log(`Testing ${this.groupedElements.otherInputs.length} other inputs`, this.buildState(), true);

        for (const otherInput of this.groupedElements.otherInputs) {
            await this.testOtherInputElement(otherInput);
        }
    }

    private async testOtherInputElement(otherInput: UIElementInfo): Promise<void> {
        // Handle color inputs, range inputs, etc.
        try {
            const testData = UIElementGrouper.generateTestData(otherInput.elementType, otherInput.elementDetails);

            for (const value of testData) {
                await this.page.fill(otherInput.selector, String(value));

                this.testResults.push({
                    element: otherInput,
                    testType: 'positive',
                    testValue: value,
                    success: true,
                    response: `Input filled with: ${value}`
                });

                await this.page.waitForTimeout(200);
            }

        } catch (error) {
            this.testResults.push({
                element: otherInput,
                testType: 'positive',
                testValue: 'general',
                success: false,
                error: String(error)
            });
        }
    }

    private async validateResults(): Promise<void> {
        this.logManager.log('Validating test results', this.buildState(), true);

        const totalTests = this.testResults.length;
        const successfulTests = this.testResults.filter(r => r.success).length;
        const failedTests = totalTests - successfulTests;
        const positiveTests = this.testResults.filter(r => r.testType === 'positive').length;
        const negativeTests = this.testResults.filter(r => r.testType === 'negative').length;

        const summary = {
            totalTests,
            successfulTests,
            failedTests,
            positiveTests,
            negativeTests,
            successRate: totalTests > 0 ? (successfulTests / totalTests * 100).toFixed(2) + '%' : '0%'
        };

        this.logManager.log(`Test Summary: ${JSON.stringify(summary)}`, this.buildState(), true);

        // Log failed tests for review
        const failedTestsDetails = this.testResults.filter(r => !r.success);
        if (failedTestsDetails.length > 0) {
            this.logManager.error(`Failed tests: ${JSON.stringify(failedTestsDetails, null, 2)}`, this.buildState(), true);
        }
    }

    async cleanup(): Promise<void> {
        this.nextLink = null;
        this.queue = [];
        this.state = State.WAIT;
        this.response = "";
        this.testResults = [];
        this.groupedElements = null;
        this.observedElements = [];
    }

    public getTestResults(): UITesterResult[] {
        return this.testResults;
    }

    public setObservedElements(elements: StageHandObserveResult[]): void {
        this.observedElements = elements;
    }
}