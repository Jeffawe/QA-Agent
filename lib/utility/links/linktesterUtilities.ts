import { UIElementInfo, UITesterResult } from "../../types.js";
import { Page } from "@browserbasehq/stagehand";

export async function quickTestButtonElement(page: Page, button: UIElementInfo): Promise<UITesterResult> {
    try {
        // Get all relevant attributes in one evaluation
        const elementInfo = await page!.evaluate((selector) => {
            let el: Element | null = null;

            if (selector.startsWith('xpath=')) {
                const xpath = selector.substring(6);
                const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                el = result.singleNodeValue as Element;
            } else {
                el = document.querySelector(selector);
            }

            if (!el) return null;

            const computedStyle = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();

            return {
                // Navigation indicators
                href: el.getAttribute('href'),
                onclick: el.getAttribute('onclick'),
                formAction: el.closest('form')?.getAttribute('action'),
                isSubmit: el.getAttribute('type') === 'submit',
                hasTarget: el.getAttribute('target'),

                // Functionality indicators
                disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
                clickable: computedStyle.pointerEvents !== 'none',
                visible: rect.width > 0 && rect.height > 0 && computedStyle.display !== 'none',

                // Element details
                tagName: el.tagName.toLowerCase(),
                type: el.getAttribute('type'),
                classes: el.className,
                id: el.id,

                // Event listeners (basic detection)
                hasClickListener: (el as HTMLElement).onclick !== null
            };
        }, button.selector);

        if (!elementInfo) {
            throw new Error('Element not found');
        }

        // Predict functionality based on attributes
        let predictedBehavior = 'unknown';
        let willNavigate = false;
        let success = true;
        let issues: string[] = [];

        // Check if element is functional
        if (elementInfo.disabled) {
            success = false;
            issues.push('Element is disabled');
        }

        if (!elementInfo.visible) {
            success = false;
            issues.push('Element is not visible');
        }

        if (!elementInfo.clickable) {
            success = false;
            issues.push('Element has pointer-events: none');
        }

        // Predict behavior and destination
        let ledTo: string | undefined = undefined;

        if (elementInfo.href) {
            if (elementInfo.href.startsWith('http') || elementInfo.href.startsWith('/')) {
                predictedBehavior = 'navigation';
                willNavigate = true;
                // Convert relative URLs to absolute
                if (elementInfo.href.startsWith('/')) {
                    const currentUrl = new URL(page!.url());
                    ledTo = `${currentUrl.origin}${elementInfo.href}`;
                } else {
                    ledTo = elementInfo.href;
                }
            } else if (elementInfo.href.startsWith('#')) {
                predictedBehavior = 'scroll/hash';
                ledTo = `${page!.url()}${elementInfo.href}`;
            } else if (elementInfo.href.startsWith('mailto:')) {
                predictedBehavior = 'email';
                ledTo = elementInfo.href;
            } else if (elementInfo.href.startsWith('tel:')) {
                predictedBehavior = 'phone';
                ledTo = elementInfo.href;
            } else {
                // Handle other protocols or invalid hrefs
                predictedBehavior = 'unknown_link';
                ledTo = elementInfo.href;
            }
        } else if (elementInfo.isSubmit || elementInfo.formAction) {
            predictedBehavior = 'form_submission';
            willNavigate = true;
            if (elementInfo.formAction) {
                // Convert relative form action to absolute
                if (elementInfo.formAction.startsWith('/')) {
                    const currentUrl = new URL(page!.url());
                    ledTo = `${currentUrl.origin}${elementInfo.formAction}`;
                } else if (elementInfo.formAction.startsWith('http')) {
                    ledTo = elementInfo.formAction;
                } else {
                    // Relative to current page
                    const currentUrl = new URL(page!.url());
                    ledTo = new URL(elementInfo.formAction, currentUrl.href).href;
                }
            } else {
                // Form submission to same page
                ledTo = page!.url();
            }
        } else if (elementInfo.onclick || elementInfo.hasClickListener) {
            predictedBehavior = 'javascript_action';
            ledTo = undefined; // Can't predict JS destinations
        } else if (elementInfo.tagName === 'button') {
            predictedBehavior = 'button_action';
            ledTo = undefined;
        }

        // Quick validation for navigation links
        if (willNavigate && elementInfo.href && elementInfo.href.startsWith('http')) {
            try {
                new URL(elementInfo.href);
            } catch {
                success = false;
                issues.push('Invalid URL');
            }
        }

        return {
            element: button,
            ledTo: ledTo,
            testType: 'positive',
            testValue: predictedBehavior,
            success: success,
            response: issues.length > 0 ? `Issues: ${issues.join(', ')}` : `Predicted: ${predictedBehavior}. Navigated to: ${ledTo}`,
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            element: button,
            testType: 'negative',
            testValue: 'error',
            success: false,
            error: errorMessage
        };
    }
}

// Fast HTTP validation for links
export async function validateLinkUrl(url: string): Promise<{ valid: boolean, status?: number, error?: string }> {
    try {
        // Skip non-HTTP links
        if (!url.startsWith('http')) {
            return { valid: true }; // Assume local links are valid
        }

        const response = await fetch(url, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000) // 5 second timeout
        });

        return {
            valid: response.status < 400,
            status: response.status
        };
    } catch (error) {
        return {
            valid: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

// Batch test multiple elements
export async function batchTestElements(page: Page, elements: UIElementInfo[], batchSize: number = 10): Promise<UITesterResult[]> {
    const allResults: UITesterResult[] = [];

    for (let i = 0; i < elements.length; i += batchSize) {
        const batch = elements.slice(i, i + batchSize);
        const batchResults = await Promise.all(
            batch.map(element => quickTestButtonElement(page, element))
        );

        allResults.push(...batchResults);

        // Small delay between batches to prevent overwhelming the page
        if (i + batchSize < elements.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    return allResults;
}

export async function simulateClickWithoutNavigation(page: Page, selector: string): Promise<boolean> {
    try {
        const result = await page.evaluate((sel) => {
            let el: Element | null = null;

            if (sel.startsWith('xpath=')) {
                const xpath = sel.substring(6);
                const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                el = result.singleNodeValue as Element;
            } else {
                el = document.querySelector(sel);
            }

            if (!el) return false;

            // Prevent default navigation behavior
            const preventDefaults = (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
            };

            // Add temporary event listeners to prevent navigation
            el.addEventListener('click', preventDefaults, { once: true, capture: true });

            if (el.tagName.toLowerCase() === 'a') {
                (el as HTMLAnchorElement).addEventListener('click', preventDefaults, { once: true });
            }

            // Create and dispatch click event
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });

            return el.dispatchEvent(clickEvent);
        }, selector);

        return result;
    } catch (error) {
        return false;
    }
}

// Alternative: Return more detailed info if you need it sometimes
export async function simulateClickWithDetails(page: Page, selector: string): Promise<{
    success: boolean;
    dispatched?: boolean;
    hasJavaScript?: boolean;
    error?: string;
}> {
    try {
        const result = await page.evaluate((sel) => {
            let el: Element | null = null;

            if (sel.startsWith('xpath=')) {
                const xpath = sel.substring(6);
                const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                el = result.singleNodeValue as Element;
            } else {
                el = document.querySelector(sel);
            }

            if (!el) return { success: false, error: 'Element not found' };

            // Check if element has JavaScript
            const hasJavaScript = !!(el as any).onclick ||
                el.getAttribute('onclick') !== null ||
                el.hasAttribute('data-*') ||
                el.classList.toString().includes('js-') ||
                el.closest('[onclick]') !== null;

            // Prevent navigation
            const preventDefaults = (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
            };

            el.addEventListener('click', preventDefaults, { once: true, capture: true });

            if (el.tagName.toLowerCase() === 'a') {
                (el as HTMLAnchorElement).addEventListener('click', preventDefaults, { once: true });
            }

            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });

            const dispatched = el.dispatchEvent(clickEvent);

            return {
                success: true,
                dispatched,
                hasJavaScript
            };
        }, selector);

        return result;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}