import { ElementDetails, FormElementInfo, StageHandObserveResult, UIElementInfo, UIElementType } from "../../types.js"
import { Page } from "@browserbasehq/stagehand";

export interface GroupedUIElements {
    buttons: UIElementInfo[];
    textInputs: UIElementInfo[];
    selects: UIElementInfo[];
    checkboxes: UIElementInfo[];
    radios: UIElementInfo[];
    forms: FormElementInfo[];
    links: UIElementInfo[];
    fileInputs: UIElementInfo[];
    dateInputs: UIElementInfo[];
    numberInputs: UIElementInfo[];
    otherInputs: UIElementInfo[];
    media: UIElementInfo[];
    interactive: UIElementInfo[];
    nonTestable: UIElementInfo[];
}

export class UIElementGrouper {
    /**
     * Groups UI elements by their type and functionality for testing
     */
    static async groupUIElements(
        elements: StageHandObserveResult[],
        page: Page
    ): Promise<GroupedUIElements> {
        const elementInfoPromises = elements.map(element => 
            this.analyzeElement(element, page)
        );

        const elementInfos = await Promise.all(elementInfoPromises);
        const validElements = elementInfos.filter(el => el !== null) as UIElementInfo[];

        // Process forms to include their child elements
        const formsWithChildren = await this.processForms(validElements, page);

        return this.groupElements(validElements, formsWithChildren);
    }

    /**
     * Analyze a single element to determine its type and details
     */
    private static async analyzeElement(
        element: StageHandObserveResult,
        page: Page
    ): Promise<UIElementInfo | null> {
        try {
            const elementInfo = await page.evaluate((selector) => {
                let el: Element | null = null;

                // Handle XPath vs CSS selector
                if (selector.startsWith('xpath=')) {
                    const xpath = selector.substring(6);
                    try {
                        const result = document.evaluate(
                            xpath,
                            document,
                            null,
                            XPathResult.FIRST_ORDERED_NODE_TYPE,
                            null
                        );
                        el = result.singleNodeValue as Element;
                    } catch (error) {
                        return null;
                    }
                } else {
                    try {
                        el = document.querySelector(selector);
                    } catch (error) {
                        return null;
                    }
                }

                if (!el) return null;

                const tagName = el.tagName.toLowerCase();
                const computedStyle = window.getComputedStyle(el);
                
                // Extract all relevant attributes
                const attributes: Record<string, string | null> = {};
                const attrNames = [
                    'type', 'role', 'disabled', 'required', 'placeholder', 'value',
                    'min', 'max', 'pattern', 'accept', 'multiple', 'readonly',
                    'checked', 'selected', 'name', 'id', 'class', 'href',
                    'src', 'alt', 'title', 'action', 'method', 'target',
                    'contenteditable', 'tabindex', 'aria-label', 'aria-labelledby'
                ];

                attrNames.forEach(attr => {
                    attributes[attr] = el!.getAttribute(attr);
                });

                // Get options for select elements
                let options: string[] = [];
                if (tagName === 'select') {
                    const optionElements = el.querySelectorAll('option');
                    options = Array.from(optionElements).map(opt => opt.textContent || '');
                }

                // Check if element is visible and interactable
                const rect = el.getBoundingClientRect();
                const isVisible = rect.width > 0 && rect.height > 0 && 
                               computedStyle.visibility !== 'hidden' && 
                               computedStyle.display !== 'none';

                return {
                    tagName,
                    attributes,
                    options,
                    isVisible,
                    computedRole: el.getAttribute('role') || null,
                    textContent: el.textContent?.trim() || '',
                    isDisabled: el.hasAttribute('disabled') || 
                               (el as any).disabled === true ||
                               computedStyle.pointerEvents === 'none'
                };
            }, element.selector);

            if (!elementInfo) return null;

            const elementType = this.determineElementType(elementInfo);
            const elementDetails = this.extractElementDetails(elementInfo);
            const testable = this.isElementTestable(elementType, elementInfo);

            return {
                ...element,
                elementType,
                elementDetails,
                testable,
                extractedAttributes: elementInfo.attributes
            };

        } catch (error) {
            console.warn(`Failed to analyze element ${element.selector}:`, error);
            return null;
        }
    }

    /**
     * Determine the UI element type based on element information
     */
    private static determineElementType(elementInfo: any): UIElementType {
        const { tagName, attributes } = elementInfo;
        const type = attributes.type?.toLowerCase();
        const role = attributes.role?.toLowerCase();

        // Handle input elements
        if (tagName === 'input') {
            switch (type) {
                case 'button':
                case 'submit':
                case 'reset':
                    return UIElementType.BUTTON;
                case 'text':
                case null:
                case undefined:
                    return UIElementType.TEXT_INPUT;
                case 'email':
                    return UIElementType.EMAIL_INPUT;
                case 'password':
                    return UIElementType.PASSWORD_INPUT;
                case 'number':
                    return UIElementType.NUMBER_INPUT;
                case 'date':
                    return UIElementType.DATE_INPUT;
                case 'file':
                    return UIElementType.FILE_INPUT;
                case 'checkbox':
                    return UIElementType.CHECKBOX;
                case 'radio':
                    return UIElementType.RADIO;
                case 'range':
                    return UIElementType.RANGE;
                case 'color':
                    return UIElementType.COLOR;
                case 'search':
                    return UIElementType.SEARCH;
                case 'tel':
                    return UIElementType.TEL;
                case 'url':
                    return UIElementType.URL_INPUT;
                case 'time':
                    return UIElementType.TIME;
                case 'datetime-local':
                    return UIElementType.DATETIME_LOCAL;
                case 'week':
                    return UIElementType.WEEK;
                case 'month':
                    return UIElementType.MONTH;
                default:
                    return UIElementType.TEXT_INPUT;
            }
        }

        // Handle other elements
        switch (tagName) {
            case 'button':
                return UIElementType.BUTTON;
            case 'textarea':
                return UIElementType.TEXTAREA;
            case 'select':
                return UIElementType.SELECT;
            case 'form':
                return UIElementType.FORM;
            case 'a':
                return UIElementType.LINK;
            case 'img':
                return UIElementType.IMAGE;
            case 'video':
                return UIElementType.VIDEO;
            case 'audio':
                return UIElementType.AUDIO;
            case 'canvas':
                return UIElementType.CANVAS;
            case 'iframe':
                return UIElementType.IFRAME;
            default:
                // Check for role-based elements
                if (role === 'button' || role === 'menuitem') {
                    return UIElementType.BUTTON;
                }
                if (role === 'textbox') {
                    return UIElementType.TEXT_INPUT;
                }
                if (role === 'checkbox') {
                    return UIElementType.CHECKBOX;
                }
                if (role === 'radio') {
                    return UIElementType.RADIO;
                }
                return UIElementType.UNKNOWN;
        }
    }

    /**
     * Extract detailed element information
     */
    private static extractElementDetails(elementInfo: any): ElementDetails {
        const { tagName, attributes, options } = elementInfo;

        return {
            tagName,
            inputType: attributes.type,
            role: attributes.role,
            disabled: attributes.disabled !== null || elementInfo.isDisabled,
            required: attributes.required !== null,
            placeholder: attributes.placeholder,
            value: attributes.value,
            options: options.length > 0 ? options : undefined,
            min: attributes.min,
            max: attributes.max,
            pattern: attributes.pattern,
            accept: attributes.accept
        };
    }

    /**
     * Determine if an element is testable
     */
    private static isElementTestable(elementType: UIElementType, elementInfo: any): boolean {
        // Not testable if disabled or not visible
        if (elementInfo.isDisabled || !elementInfo.isVisible) {
            return false;
        }

        // Most interactive elements are testable
        const testableTypes = [
            UIElementType.BUTTON,
            UIElementType.TEXT_INPUT,
            UIElementType.EMAIL_INPUT,
            UIElementType.PASSWORD_INPUT,
            UIElementType.NUMBER_INPUT,
            UIElementType.DATE_INPUT,
            UIElementType.FILE_INPUT,
            UIElementType.TEXTAREA,
            UIElementType.SELECT,
            UIElementType.CHECKBOX,
            UIElementType.RADIO,
            UIElementType.SEARCH,
            UIElementType.TEL,
            UIElementType.URL_INPUT,
            UIElementType.COLOR,
            UIElementType.RANGE,
            UIElementType.LINK,
            UIElementType.TIME,
            UIElementType.DATETIME_LOCAL,
            UIElementType.WEEK,
            UIElementType.MONTH
        ];

        return testableTypes.includes(elementType);
    }

    /**
     * Process forms to include their child elements
     */
    private static async processForms(
        elements: UIElementInfo[],
        page: Page
    ): Promise<FormElementInfo[]> {
        const forms = elements.filter(el => el.elementType === UIElementType.FORM);
        
        const formInfoPromises = forms.map(async (form): Promise<FormElementInfo> => {
            try {
                const formDetails = await page.evaluate((selector) => {
                    let formEl: Element | null = null;

                    if (selector.startsWith('xpath=')) {
                        const xpath = selector.substring(6);
                        const result = document.evaluate(
                            xpath,
                            document,
                            null,
                            XPathResult.FIRST_ORDERED_NODE_TYPE,
                            null
                        );
                        formEl = result.singleNodeValue as Element;
                    } else {
                        formEl = document.querySelector(selector);
                    }

                    if (!formEl) return null;

                    const formAction = formEl.getAttribute('action');
                    const formMethod = formEl.getAttribute('method') || 'GET';

                    // Find all form elements within this form
                    const formElements = formEl.querySelectorAll(
                        'input, textarea, select, button, [role="button"], [role="textbox"], [role="checkbox"], [role="radio"]'
                    );

                    const childSelectors: string[] = [];
                    formElements.forEach((el, index) => {
                        // Generate a selector for each child element
                        const tagName = el.tagName.toLowerCase();
                        const id = el.id;
                        const className = el.className;
                        const name = el.getAttribute('name');
                        
                        let childSelector = '';
                        if (id) {
                            childSelector = `#${id}`;
                        } else if (name) {
                            childSelector = `${tagName}[name="${name}"]`;
                        } else if (className) {
                            childSelector = `${tagName}.${className.split(' ')[0]}`;
                        } else {
                            childSelector = `${tagName}:nth-of-type(${index + 1})`;
                        }
                        
                        childSelectors.push(childSelector);
                    });

                    return {
                        formAction,
                        formMethod,
                        childSelectors
                    };
                }, form.selector);

                if (!formDetails) {
                    return form as FormElementInfo;
                }

                // Find child elements that match the form's children
                const formChildren = elements.filter(el => 
                    formDetails.childSelectors.some(selector => 
                        el.selector.includes(selector) || selector.includes(el.selector)
                    )
                );

                return {
                    ...form,
                    formElements: formChildren,
                    formAction: formDetails.formAction,
                    formMethod: formDetails.formMethod
                } as FormElementInfo;

            } catch (error) {
                console.warn(`Failed to process form ${form.selector}:`, error);
                return form as FormElementInfo;
            }
        });

        return Promise.all(formInfoPromises);
    }

    /**
     * Group elements into categories for testing
     */
    private static groupElements(
        elements: UIElementInfo[],
        forms: FormElementInfo[]
    ): GroupedUIElements {
        const groups: GroupedUIElements = {
            buttons: [],
            textInputs: [],
            selects: [],
            checkboxes: [],
            radios: [],
            forms: forms,
            links: [],
            fileInputs: [],
            dateInputs: [],
            numberInputs: [],
            otherInputs: [],
            media: [],
            interactive: [],
            nonTestable: []
        };

        for (const element of elements) {
            if (!element.testable) {
                groups.nonTestable.push(element);
                continue;
            }

            switch (element.elementType) {
                case UIElementType.BUTTON:
                    groups.buttons.push(element);
                    break;
                case UIElementType.TEXT_INPUT:
                case UIElementType.EMAIL_INPUT:
                case UIElementType.PASSWORD_INPUT:
                case UIElementType.SEARCH:
                case UIElementType.TEL:
                case UIElementType.URL_INPUT:
                case UIElementType.TEXTAREA:
                    groups.textInputs.push(element);
                    break;
                case UIElementType.NUMBER_INPUT:
                case UIElementType.RANGE:
                    groups.numberInputs.push(element);
                    break;
                case UIElementType.DATE_INPUT:
                case UIElementType.TIME:
                case UIElementType.DATETIME_LOCAL:
                case UIElementType.WEEK:
                case UIElementType.MONTH:
                    groups.dateInputs.push(element);
                    break;
                case UIElementType.SELECT:
                    groups.selects.push(element);
                    break;
                case UIElementType.CHECKBOX:
                    groups.checkboxes.push(element);
                    break;
                case UIElementType.RADIO:
                    groups.radios.push(element);
                    break;
                case UIElementType.FILE_INPUT:
                    groups.fileInputs.push(element);
                    break;
                case UIElementType.LINK:
                    groups.links.push(element);
                    break;
                case UIElementType.COLOR:
                    groups.otherInputs.push(element);
                    break;
                case UIElementType.VIDEO:
                case UIElementType.AUDIO:
                case UIElementType.IMAGE:
                case UIElementType.CANVAS:
                    groups.media.push(element);
                    break;
                default:
                    groups.interactive.push(element);
                    break;
            }
        }

        return groups;
    }

    /**
     * Generate test data for different element types
     */
    static generateTestData(elementType: UIElementType, elementDetails: ElementDetails): any[] {
        const testData: any[] = [];

        switch (elementType) {
            case UIElementType.TEXT_INPUT:
            case UIElementType.TEXTAREA:
                testData.push(
                    'Test text',
                    'A longer test string with special characters !@#$%',
                    '12345',
                    '', // empty string
                    'x'.repeat(100) // long string
                );
                break;

            case UIElementType.EMAIL_INPUT:
                testData.push(
                    'test@example.com',
                    'user.name+tag@domain.co.uk',
                    'invalid-email', // invalid format
                    ''
                );
                break;

            case UIElementType.PASSWORD_INPUT:
                testData.push(
                    'password123',
                    'P@ssw0rd!',
                    '12345678',
                    'short',
                    ''
                );
                break;

            case UIElementType.NUMBER_INPUT:
                const min = elementDetails.min ? parseInt(elementDetails.min) : 0;
                const max = elementDetails.max ? parseInt(elementDetails.max) : 100;
                testData.push(
                    min,
                    max,
                    Math.floor((min + max) / 2),
                    min - 1, // below minimum
                    max + 1, // above maximum
                    0
                );
                break;

            case UIElementType.DATE_INPUT:
                testData.push(
                    '2024-01-01',
                    '2024-12-31',
                    new Date().toISOString().split('T')[0], // today
                    '1900-01-01', // very old date
                    '2100-12-31'  // future date
                );
                break;

            case UIElementType.SELECT:
                if (elementDetails.options && elementDetails.options.length > 0) {
                    // Add each option as test data
                    testData.push(...elementDetails.options);
                }
                break;

            case UIElementType.CHECKBOX:
            case UIElementType.RADIO:
                testData.push(true, false);
                break;

            case UIElementType.SEARCH:
                testData.push(
                    'search query',
                    'product name',
                    '12345',
                    ''
                );
                break;

            case UIElementType.TEL:
                testData.push(
                    '+1234567890',
                    '(123) 456-7890',
                    '123-456-7890',
                    '1234567890',
                    'invalid-phone'
                );
                break;

            case UIElementType.URL_INPUT:
                testData.push(
                    'https://example.com',
                    'http://test.org',
                    'ftp://files.com',
                    'invalid-url',
                    ''
                );
                break;

            case UIElementType.COLOR:
                testData.push(
                    '#FF0000',
                    '#00FF00',
                    '#0000FF',
                    '#FFFFFF',
                    '#000000'
                );
                break;

            case UIElementType.RANGE:
                const rangeMin = elementDetails.min ? parseInt(elementDetails.min) : 0;
                const rangeMax = elementDetails.max ? parseInt(elementDetails.max) : 100;
                testData.push(
                    rangeMin,
                    rangeMax,
                    Math.floor((rangeMin + rangeMax) / 2)
                );
                break;

            default:
                testData.push('test');
                break;
        }

        return testData;
    }

    /**
     * Get summary statistics of grouped elements
     */
    static getElementSummary(groups: GroupedUIElements): Record<string, number> {
        return {
            totalElements: Object.values(groups).reduce((sum, group) => sum + group.length, 0),
            buttons: groups.buttons.length,
            textInputs: groups.textInputs.length,
            selects: groups.selects.length,
            checkboxes: groups.checkboxes.length,
            radios: groups.radios.length,
            forms: groups.forms.length,
            links: groups.links.length,
            fileInputs: groups.fileInputs.length,
            dateInputs: groups.dateInputs.length,
            numberInputs: groups.numberInputs.length,
            otherInputs: groups.otherInputs.length,
            media: groups.media.length,
            interactive: groups.interactive.length,
            nonTestable: groups.nonTestable.length
        };
    }
}