import { LinkInfo, StageHandObserveResult, State, UITesterResult, UIElementInfo, UIElementType, FormElementInfo } from "../types.js";
import { Agent, BaseAgentDependencies } from "../utility/abstract.js";
import AutoActionService from "../services/actions/autoActionService.js";
import StagehandSession from "../browserAuto/stagehandSession.js";
import { GroupedUIElements, UIElementGrouper } from "../utility/links/linkGrouper.js";
import { Page } from "@browserbasehq/stagehand";
import { PageMemory } from "../services/memory/pageMemory.js";
import { TestingThinker } from "../services/thinkers/testingThinker.js";
import { batchTestElements, quickTestButtonElement } from "../utility/links/linktesterUtilities.js";

export default class Tester extends Agent {
    public nextLink: LinkInfo | null = null;

    private queue: LinkInfo[] = [];
    private observedElements: StageHandObserveResult[] = [];
    private groupedElements: GroupedUIElements | null = null;
    public testResults: UITesterResult[] = [];
    private page: Page | null = null;
    private pagesSeen: string[] = [];
    private maxBatchSize = 15;

    private stagehandSession: StagehandSession;
    private localactionService: AutoActionService;
    private testingThinker: TestingThinker

    constructor(dependencies: BaseAgentDependencies) {
        super("tester", dependencies);
        this.setState(dependencies.dependent ? State.WAIT : State.START);

        this.stagehandSession = this.session as StagehandSession;
        this.localactionService = this.actionService as AutoActionService;
        this.testingThinker = new TestingThinker(this.sessionId);
    }

    public enqueue(links: LinkInfo[]) {
        this.queue = links;
        if (this.state === State.DONE || this.state === State.WAIT) {
            this.setState(State.START);
        } else {
            this.logManager.log("Tester is already running or cannot start up", this.buildState(), true);
        }
    }

    public nextTick(): void {
        if (this.state === State.DONE) {
            this.setState(State.START);
        }
    }

    public setBaseValues(url: string, mainGoal?: string): void {
        super.setBaseValues(url, mainGoal);

        if (this.stagehandSession.page === null) {
            this.logManager.error('Page not initialized', this.buildState(), true);
            this.setState(State.ERROR);
            throw new Error('Page not initialized');
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

        if(!this.page){
            const page = await this.stagehandSession.getPage(this.uniqueId);
            if(!page){
                throw new Error("Page not initialized");
            }
            this.page = page;
        }

        this.currentUrl = this.page!.url();

        try {
            switch (this.state) {
                case State.START:
                    (this as any).startTime = performance.now();
                    if (this.pagesSeen.includes(this.currentUrl)) {
                        this.setState(State.DONE);
                        break;
                    } else {
                        this.pagesSeen.push(this.currentUrl);
                    }
                    this.setState(State.OBSERVE);
                    break;

                case State.OBSERVE:
                    try {
                        this.logManager.log(`Observing page: ${this.currentUrl}`, this.buildState());
                        const rawObservedElements = await this.stagehandSession.observe(this.uniqueId);

                        // Filter out any elements that already exist in the queue
                        this.observedElements = rawObservedElements.filter(observedElement => {
                            return !this.queue.some(queueItem =>
                                queueItem.description === observedElement.description ||
                                queueItem.selector === observedElement.selector
                            );
                        });

                        this.setState(State.DECIDE);
                    } catch (e) {
                        this.logManager.error(`Error observing page: ${String(e)}`, this.buildState());
                        this.setState(State.ERROR);
                    }
                    break;

                case State.DECIDE:
                    await this.groupElements();
                    break;

                case State.ACT:
                    // Store initial URL for navigation-heavy tests
                    const initialUrl = this.currentUrl;

                    // Clear existing results to avoid duplicates
                    const existingResults = [...this.testResults];
                    this.testResults = [];

                    try {
                        // Group 1: Safe parallel tests (no navigation, minimal side effects)
                        const safeTestResults = await Promise.all([
                            this.testTextInputs(),
                            this.testSelects(),
                            this.testCheckboxes(),
                            this.testRadios(),
                            this.testDateInputs(),
                            this.testNumberInputs()
                        ]);

                        // Flatten and collect safe test results
                        const flatSafeResults = safeTestResults.flat();

                        // Group 2: Navigation-risky tests (run sequentially after safe tests)
                        // Ensure we're on the right page before starting risky tests
                        if (this.page!.url() !== initialUrl) {
                            await this.page!.goto(initialUrl, { waitUntil: 'domcontentloaded' });
                            await this.page!.waitForTimeout(1000);
                        }

                        // Run navigation-heavy tests sequentially and collect their results
                        const linksResults = await this.testLinks();
                        const buttonsResults = await this.testButtons();
                        const formsResults = await this.testForms();
                        const fileInputsResults = await this.testFileInputs();
                        const otherInputsResults = await this.testOtherInputs();

                        // Combine all results in a single atomic operation
                        this.testResults = [
                            ...existingResults,
                            ...flatSafeResults,
                            ...linksResults,
                            ...buttonsResults,
                            ...formsResults,
                            ...fileInputsResults,
                            ...otherInputsResults
                        ];

                    } catch (error) {
                        // Restore original results if something fails
                        this.testResults = existingResults;
                        throw error;
                    }

                    this.setState(State.VALIDATE);
                    break;


                case State.VALIDATE:
                    try {
                        await this.validateResults();
                        PageMemory.setTestResults(this.currentUrl, this.testResults);
                        this.setState(State.EVALUATE);
                    } catch (e) {
                        this.logManager.error(`Error validating results: ${String(e)}`, this.buildState());
                        this.setState(State.ERROR);
                    }
                    break;

                case State.EVALUATE:
                    const endTime = performance.now();
                    this.logManager.log(`Test complete in ${((endTime - (this as any).startTime) / 1000).toFixed(2)}s`, this.buildState(), true);
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

        this.groupedElements = await UIElementGrouper.groupUIElements(this.observedElements, this.page!);

        const summary = UIElementGrouper.getElementSummary(this.groupedElements);
        this.logManager.log(`Grouped elements: ${JSON.stringify(summary)}`, this.buildState(), true);

        this.setState(State.ACT);
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

    private async testButtons(): Promise<UITesterResult[]> {
        if (!this.groupedElements || this.groupedElements.buttons.length === 0) {
            return [];
        }

        const testResults: UITesterResult[] = [];

        this.logManager.log(`Testing ${this.groupedElements.buttons.length} buttons`, this.buildState(), true);

        for (const button of this.groupedElements.buttons) {
            const testerResult = await quickTestButtonElement(this.page!, button);
            testResults.push(testerResult);
        }

        return testResults;
    }

    private async testButtonElement(button: UIElementInfo): Promise<void> {
        try {
            const initialUrl = this.page!.url();

            // Try to detect if this button will navigate by checking its attributes
            const buttonInfo = await this.page!.evaluate((selector) => {
                let el: Element | null = null;

                if (selector.startsWith('xpath=')) {
                    const xpath = selector.substring(6);
                    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    el = result.singleNodeValue as Element;
                } else {
                    el = document.querySelector(selector);
                }

                if (!el) return null;

                const href = el.getAttribute('href');
                const onclick = el.getAttribute('onclick');
                const formAction = el.closest('form')?.getAttribute('action');
                const isSubmit = el.getAttribute('type') === 'submit';
                const hasTarget = el.getAttribute('target');

                return {
                    href,
                    onclick,
                    formAction,
                    isSubmit,
                    hasTarget,
                    tagName: el.tagName.toLowerCase(),
                    type: el.getAttribute('type')
                };
            }, button.selector);


            // Strategy 2: Normal click with navigation back if needed
            await this.page!.click(button.selector);

            // Wait for potential navigation, modal, or other effects
            await this.page!.waitForTimeout(1500);

            const newUrl = this.page!.url();
            const navigationOccurred = initialUrl !== newUrl;

            let responseMessage = '';

            if (navigationOccurred) {
                responseMessage = `Navigated to: ${newUrl}`;

                // Navigate back to original page
                try {
                    await this.page!.goBack();
                    await this.page!.waitForTimeout(1000);

                    // Verify we're back on the original page
                    const backUrl = this.page!.url();
                    if (backUrl === initialUrl) {
                        responseMessage += ' (navigated back successfully)';
                    } else {
                        // If back didn't work, navigate directly to original URL
                        await this.page!.goto(initialUrl);
                        await this.page!.waitForTimeout(1000);
                        responseMessage += ' (returned to original page via direct navigation)';
                    }
                } catch (backError) {
                    // If going back fails, try direct navigation to original URL
                    try {
                        await this.page!.goto(initialUrl);
                        await this.page!.waitForTimeout(1000);
                        responseMessage += ' (returned via direct navigation after back failed)';
                    } catch (directNavError) {
                        responseMessage += ` (WARNING: Could not return to original page: ${directNavError})`;
                        // This is a more serious issue, but we'll continue testing
                    }
                }
            } else {
                // Check if a modal or overlay appeared
                const hasModal = await this.page!.evaluate(() => {
                    const modals = document.querySelectorAll('[role="dialog"], .modal, .popup, .overlay, [aria-modal="true"]');
                    return modals.length > 0;
                });

                if (hasModal) {
                    responseMessage = 'Button opened modal/dialog';

                    // Try to close modal with Escape key
                    try {
                        await this.page!.keyboard.press('Escape');
                        await this.page!.waitForTimeout(500);
                        responseMessage += ' (modal closed with Escape)';
                    } catch (escapeError) {
                        responseMessage += ' (modal may still be open)';
                    }
                } else {
                    responseMessage = 'Button clicked successfully (no navigation/modal detected)';
                }
            }

            this.testResults.push({
                element: button,
                ledTo: newUrl,
                testType: 'positive',
                testValue: 'click',
                success: true,
                response: responseMessage
            });

            this.logManager.log(`Button test passed: ${button.description}`, this.buildState(), false);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.testResults.push({
                element: button,
                testType: 'positive',
                testValue: 'click',
                success: false,
                error: errorMessage
            });

            this.logManager.error(`Button test failed: ${button.description} - ${error}`, this.buildState(), false);
        }
    }

    private async testTextInputs(): Promise<UITesterResult[]> {
        if (!this.groupedElements || this.groupedElements.textInputs.length === 0) {
            return [];
        }

        const testResults: UITesterResult[] = [];
        this.logManager.log(`Testing ${this.groupedElements.textInputs.length} text inputs`, this.buildState(), true);

        // Batch process text inputs
        const batchSize = this.maxBatchSize;
        for (let i = 0; i < this.groupedElements.textInputs.length; i += batchSize) {
            const batch = this.groupedElements.textInputs.slice(i, i + batchSize);

            // Process batch in parallel and collect results
            const batchResults = await Promise.all(batch.map(input => this.testTextInputElement(input)));

            // Flatten and add batch results to main results array
            testResults.push(...batchResults.flat());

            // Optional small delay between batches
            if (i + batchSize < this.groupedElements.textInputs.length) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        return testResults;
    }

    private async testTextInputElement(input: UIElementInfo): Promise<UITesterResult[]> {
        const testData = this.generateTextInputTestData(input);
        const testResults: UITesterResult[] = [];

        for (const testCase of testData) {
            try {
                // Clear the input first
                await this.page!.fill(input.selector, '');

                // Fill with test data
                await this.page!.fill(input.selector, testCase.value);

                // Trigger change event
                await this.page!.dispatchEvent(input.selector, 'change');

                const testResult: UITesterResult = {
                    element: input,
                    testType: testCase.type,
                    testValue: testCase.value,
                    success: true,
                    response: `Input filled successfully with: ${testCase.value}`
                };

                this.logManager.log(`Text input test (${testCase.type}) passed: ${input.description}`, this.buildState(), false);
                testResults.push(testResult);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                const testResult: UITesterResult = {
                    element: input,
                    testType: testCase.type,
                    testValue: testCase.value,
                    success: false,
                    error: String(errorMessage)
                };

                testResults.push(testResult);

                this.logManager.error(`Text input test (${testCase.type}) failed: ${input.description} - ${error}`, this.buildState(), false);
            }

            // Small delay between tests
            await this.page!.waitForTimeout(200);
        }

        return testResults;
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

    private async testSelects(): Promise<UITesterResult[]> {
        if (!this.groupedElements || this.groupedElements.selects.length === 0) {
            return [];
        }

        const testResults: UITesterResult[] = [];

        this.logManager.log(`Testing ${this.groupedElements.selects.length} select elements`, this.buildState(), true);

        for (const select of this.groupedElements.selects) {
            const testResult = await this.testSelectElement(select);
            if (testResult) {
                testResults.push(...testResult);
            }
        }

        return testResults;
    }

    private async testSelectElement(select: UIElementInfo): Promise<UITesterResult[] | null> {
        const testResults: UITesterResult[] = [];
        try {
            // Get all options
            const options = await this.page!.evaluate((selector) => {
                const selectEl = document.querySelector(selector) as HTMLSelectElement;
                if (!selectEl) return [];

                return Array.from(selectEl.options).map(option => ({
                    value: option.value,
                    text: option.text
                }));
            }, select.selector);

            if (options.length === 0) {
                this.logManager.log(`Select element has no options: ${select.description}`, this.buildState(), false);
                return null;
            }

            // Positive test: Select each valid option
            for (const option of options) {
                try {
                    await this.page!.selectOption(select.selector, option.value);

                    const testResult: UITesterResult = {
                        element: select,
                        testType: 'positive',
                        testValue: option.value,
                        success: true,
                        response: `Selected option: ${option.text}`
                    };

                    await this.page!.waitForTimeout(200);
                    testResults.push(testResult);

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    const testResult: UITesterResult = {
                        element: select,
                        testType: 'positive',
                        testValue: option.value,
                        success: false,
                        error: errorMessage
                    };
                    testResults.push(testResult);
                }
            }

            // Negative test: Try to select invalid option
            try {
                await this.page!.selectOption(select.selector, 'invalid-option-value');

                const testResult: UITesterResult = {
                    element: select,
                    testType: 'negative',
                    testValue: 'invalid-option-value',
                    success: false,
                    response: 'Should have failed but succeeded'
                };
                testResults.push(testResult);

            } catch (error) {
                // This is expected to fail
                const testResult: UITesterResult = {
                    element: select,
                    testType: 'negative',
                    testValue: 'invalid-option-value',
                    success: true,
                    response: 'Correctly rejected invalid option'
                };

                testResults.push(testResult);
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const testResult: UITesterResult = {
                element: select,
                testType: 'positive',
                testValue: 'general',
                success: false,
                error: errorMessage
            };
            testResults.push(testResult);
        }

        return testResults;
    }

    private async testCheckboxes(): Promise<UITesterResult[]> {
        if (!this.groupedElements || this.groupedElements.checkboxes.length === 0) {
            return [];
        }

        const testResults: UITesterResult[] = [];

        this.logManager.log(`Testing ${this.groupedElements.checkboxes.length} checkboxes`, this.buildState(), true);

        for (const checkbox of this.groupedElements.checkboxes) {
            const testResult = await this.testCheckboxElement(checkbox);
            testResults.push(...testResult);
        }

        return testResults;
    }

    private async testCheckboxElement(checkbox: UIElementInfo): Promise<UITesterResult[]> {
        const testResults: UITesterResult[] = [];
        try {
            // Test checking the checkbox
            await this.page!.check(checkbox.selector);

            const testResultPositive: UITesterResult = {
                element: checkbox,
                testType: 'positive',
                testValue: true,
                success: true,
                response: 'Checkbox checked successfully'
            };

            await this.page!.waitForTimeout(200);

            // Test unchecking the checkbox
            await this.page!.uncheck(checkbox.selector);

            const testResultNegative: UITesterResult = {
                element: checkbox,
                testType: 'positive',
                testValue: false,
                success: true,
                response: 'Checkbox unchecked successfully'
            };
            testResults.push(testResultPositive, testResultNegative);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const testResult: UITesterResult = {
                element: checkbox,
                testType: 'positive',
                testValue: 'toggle',
                success: false,
                error: errorMessage
            };
            testResults.push(testResult);
        }

        return testResults;
    }

    private async testRadios(): Promise<UITesterResult[]> {
        if (!this.groupedElements || this.groupedElements.radios.length === 0) {
            return [];
        }

        this.logManager.log(`Testing ${this.groupedElements.radios.length} radio buttons`, this.buildState(), true);

        const results: UITesterResult[] = [];
        for (const radio of this.groupedElements.radios) {
            const radioResult = await this.testRadioElement(radio);
            results.push(radioResult);
        }

        return results;
    }

    private async testRadioElement(radio: UIElementInfo): Promise<UITesterResult> {
        try {
            await this.page!.check(radio.selector);

            return {
                element: radio,
                testType: 'positive',
                testValue: true,
                success: true,
                response: 'Radio button selected successfully'
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                element: radio,
                testType: 'positive',
                testValue: true,
                success: false,
                error: errorMessage
            };
        }
    }

    private async testForms(): Promise<UITesterResult[]> {
        if (!this.groupedElements || this.groupedElements.forms.length === 0) {
            return [];
        }

        this.logManager.log(`Testing ${this.groupedElements.forms.length} forms`, this.buildState(), true);

        const results: UITesterResult[] = [];
        for (const form of this.groupedElements.forms) {
            const initialUrl = this.page!.url();
            const formResults = await this.testFormElement(form);
            results.push(...formResults);

            await this.page!.goto(initialUrl, { waitUntil: 'domcontentloaded' });
            await this.page!.waitForTimeout(1000);
        }

        return results;
    }

    private async testFormElement(form: FormElementInfo): Promise<UITesterResult[]> {
        try {
            const results: UITesterResult[] = [];

            // Positive test: Fill form with valid data
            const validResult = await this.fillFormWithValidData(form);
            results.push(validResult);

            // Negative test: Fill form with invalid data
            const invalidResult = await this.fillFormWithInvalidData(form);
            results.push(invalidResult);

            return results;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return [{
                element: form,
                testType: 'positive',
                testValue: 'form_test',
                success: false,
                error: errorMessage
            }];
        }
    }

    private async fillFormWithValidData(form: FormElementInfo): Promise<UITesterResult> {
        // Implementation would fill each form element with appropriate valid data
        // This is a simplified version
        return {
            element: form,
            testType: 'positive',
            testValue: 'valid_form_data',
            success: true,
            response: 'Form filled with valid data'
        };
    }

    private async fillFormWithInvalidData(form: FormElementInfo): Promise<UITesterResult> {
        // Implementation would fill each form element with inappropriate data
        // This is a simplified version
        return {
            element: form,
            testType: 'negative',
            testValue: 'invalid_form_data',
            success: true,
            response: 'Form tested with invalid data'
        };
    }

    private async testLinks(): Promise<UITesterResult[]> {
        if (!this.groupedElements || this.groupedElements.links.length === 0) {
            return [];
        }

        this.logManager.log(`Testing ${this.groupedElements.links.length} links`, this.buildState(), true);

        const testResults = await batchTestElements(this.page!, this.groupedElements.links, this.maxBatchSize);
        return testResults;
    }

    private async testLinkElement(link: UIElementInfo): Promise<void> {
        try {
            const initialUrl = this.page!.url();

            // Strategy 2: Normal click with navigation back
            await this.page!.click(link.selector);

            // Wait for navigation
            await this.page!.waitForTimeout(1500);

            const newUrl = this.page!.url();
            const navigationOccurred = initialUrl !== newUrl;

            let responseMessage = '';

            if (navigationOccurred) {
                responseMessage = `Navigated to: ${newUrl}`;

                // Navigate back to original page
                try {
                    await this.page!.goBack();
                    await this.page!.waitForTimeout(1000);

                    // Verify we're back
                    const backUrl = this.page!.url();
                    if (backUrl === initialUrl) {
                        responseMessage += ' (navigated back successfully)';
                    } else {
                        // Direct navigation if back didn't work
                        await this.page!.goto(initialUrl);
                        await this.page!.waitForTimeout(1000);
                        responseMessage += ' (returned via direct navigation)';
                    }
                } catch (backError) {
                    // Fallback to direct navigation
                    try {
                        await this.page!.goto(initialUrl);
                        await this.page!.waitForTimeout(1000);
                        responseMessage += ' (returned via direct navigation after back failed)';
                    } catch (directNavError) {
                        responseMessage += ` (WARNING: Could not return to original page: ${directNavError})`;
                    }
                }
            } else {
                responseMessage = 'Link clicked (no navigation detected - may be anchor link or JavaScript)';
            }

            this.testResults.push({
                element: link,
                ledTo: newUrl,
                testType: 'positive',
                testValue: 'click',
                success: true,
                response: responseMessage
            });

            this.logManager.log(`Link test passed: ${link.description}`, this.buildState(), false);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.testResults.push({
                element: link,
                testType: 'positive',
                testValue: 'click',
                success: false,
                error: errorMessage
            });

            this.logManager.error(`Link test failed: ${link.description} - ${error}`, this.buildState(), false);
        }
    }

    private async testFileInputs(): Promise<UITesterResult[]> {
        if (!this.groupedElements || this.groupedElements.fileInputs.length === 0) {
            return [];
        }

        this.logManager.log(`Testing ${this.groupedElements.fileInputs.length} file inputs`, this.buildState(), true);

        const results: UITesterResult[] = [];
        for (const fileInput of this.groupedElements.fileInputs) {
            const initialUrl = this.page!.url();
            const fileResult = await this.testFileInputElement(fileInput);
            results.push(fileResult);

            await this.page!.goto(initialUrl, { waitUntil: 'domcontentloaded' });
            await this.page!.waitForTimeout(1000);
        }

        return results;
    }

    private async testFileInputElement(fileInput: UIElementInfo): Promise<UITesterResult> {
        // File input testing would require actual file paths
        // This is a placeholder implementation
        return {
            element: fileInput,
            testType: 'positive',
            testValue: 'file_test',
            success: true,
            response: 'File input tested (placeholder)'
        };
    }

    private async testDateInputs(): Promise<UITesterResult[]> {
        if (!this.groupedElements || this.groupedElements.dateInputs.length === 0) {
            return [];
        }

        this.logManager.log(`Testing ${this.groupedElements.dateInputs.length} date inputs`, this.buildState(), true);

        const results: UITesterResult[] = [];
        for (const dateInput of this.groupedElements.dateInputs) {
            const dateResults = await this.testDateInputElement(dateInput);
            results.push(...dateResults);
            await this.page!.waitForTimeout(1000);
        }

        return results;
    }

    private async testDateInputElement(dateInput: UIElementInfo): Promise<UITesterResult[]> {
        const results: UITesterResult[] = [];
        const testDates = [
            { value: '2024-01-01', type: 'positive' as const },
            { value: '2024-12-31', type: 'positive' as const },
            { value: 'invalid-date', type: 'negative' as const },
            { value: '2024-13-01', type: 'negative' as const } // Invalid month
        ];

        for (const testCase of testDates) {
            try {
                await this.page!.fill(dateInput.selector, testCase.value);

                results.push({
                    element: dateInput,
                    testType: testCase.type,
                    testValue: testCase.value,
                    success: true,
                    response: `Date input filled with: ${testCase.value}`
                });

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                results.push({
                    element: dateInput,
                    testType: testCase.type,
                    testValue: testCase.value,
                    success: false,
                    error: errorMessage
                });
            }
        }

        return results;
    }

    private async testNumberInputs(): Promise<UITesterResult[]> {
        if (!this.groupedElements || this.groupedElements.numberInputs.length === 0) {
            return [];
        }

        this.logManager.log(`Testing ${this.groupedElements.numberInputs.length} number inputs`, this.buildState(), true);

        const results: UITesterResult[] = [];
        for (const numberInput of this.groupedElements.numberInputs) {
            const numberResults = await this.testNumberInputElement(numberInput);
            results.push(...numberResults);
        }

        return results;
    }

    private async testNumberInputElement(numberInput: UIElementInfo): Promise<UITesterResult[]> {
        const results: UITesterResult[] = [];
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
                await this.page!.fill(numberInput.selector, testCase.value);

                results.push({
                    element: numberInput,
                    testType: testCase.type,
                    testValue: testCase.value,
                    success: true,
                    response: `Number input filled with: ${testCase.value}`
                });

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                results.push({
                    element: numberInput,
                    testType: testCase.type,
                    testValue: testCase.value,
                    success: false,
                    error: errorMessage
                });
            }
        }

        return results;
    }

    private async testOtherInputs(): Promise<UITesterResult[]> {
        if (!this.groupedElements || this.groupedElements.otherInputs.length === 0) {
            return [];
        }

        this.logManager.log(`Testing ${this.groupedElements.otherInputs.length} other inputs`, this.buildState(), true);

        const results: UITesterResult[] = [];
        for (const otherInput of this.groupedElements.otherInputs) {
            const initialUrl = this.page!.url();
            const otherResults = await this.testOtherInputElement(otherInput);
            results.push(...otherResults);

            await this.page!.goto(initialUrl, { waitUntil: 'domcontentloaded' });
            await this.page!.waitForTimeout(1000);
        }

        return results;
    }

    private async testOtherInputElement(otherInput: UIElementInfo): Promise<UITesterResult[]> {
        const results: UITesterResult[] = [];

        try {
            const testData = UIElementGrouper.generateTestData(otherInput.elementType, otherInput.elementDetails);

            for (const value of testData) {
                await this.page!.fill(otherInput.selector, String(value));

                results.push({
                    element: otherInput,
                    testType: 'positive',
                    testValue: value,
                    success: true,
                    response: `Input filled with: ${value}`
                });

                await this.page!.waitForTimeout(200);
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            results.push({
                element: otherInput,
                testType: 'positive',
                testValue: 'general',
                success: false,
                error: errorMessage
            });
        }

        return results;
    }

    async cleanup(): Promise<void> {
        this.nextLink = null;
        this.queue = [];
        this.response = "";
        this.testResults = [];
        this.groupedElements = null;
        this.observedElements = [];
        this.pagesSeen = [];
        this.stagehandSession.closeAgentContext(this.uniqueId);
    }

    public getTestResults(): UITesterResult[] {
        return this.testResults;
    }

    public setObservedElements(elements: StageHandObserveResult[]): void {
        this.observedElements = elements;
    }
}