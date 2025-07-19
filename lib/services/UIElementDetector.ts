import { spawnSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Box, InteractiveElement, State } from '../types.js';
import { LogManager } from '../utility/logManager.js';
import { Page } from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function detectUIWithPython(imagePath: string): Box[] {
    const scriptPath = path.join(__dirname, '../python/detect_ui.py');

    const pythonPath = path.resolve(__dirname, '../python/venv/Scripts/python.exe');
    const result = spawnSync(pythonPath, [scriptPath, path.resolve(imagePath)], {
        encoding: 'utf8',
        timeout: 3000,
    });

    if (result.error) {
        console.error('Python error:', result.error.message);
        return [];
    }

    try {
        LogManager.log(`Python output: ${result.stdout.trim()}`, State.DECIDE, false);
        return JSON.parse(result.stdout.trim());
    } catch (e) {
        console.error('Failed to parse Python output:', result.stdout);
        return [];
    }
}


export async function getInteractiveElements(page: Page): Promise<InteractiveElement[]> {
    const elements: InteractiveElement[] = await page.evaluate(`
        (function() {
            // Helper function to generate reliable selectors
            function generateSelector(element) {
                // Try ID first
                if (element.id) return '#' + element.id;

                // Try data-testid
                var testId = element.getAttribute('data-testid');
                if (testId) return '[data-testid="' + testId + '"]';

                // Try unique class combination
                if (element.className && typeof element.className === 'string') {
                    var classes = element.className.split(' ').filter(function(c) { return c; });
                    if (classes.length > 0) {
                        var classSelector = '.' + classes.join('.');
                        try {
                            if (document.querySelectorAll(classSelector).length === 1) {
                                return classSelector;
                            }
                        } catch (e) {
                            // Continue if selector is invalid
                        }
                    }
                }

                // Generate nth-child path as fallback
                return generateNthChildPath(element);
            }

            function generateNthChildPath(element) {
                if (element === document.body) return 'body';

                var path = [];
                var currentElement = element;

                while (currentElement && currentElement !== document.body) {
                    var selector = currentElement.tagName.toLowerCase();

                    if (currentElement.id) {
                        selector += '#' + currentElement.id;
                        path.unshift(selector);
                        break;
                    }

                    var parent = currentElement.parentNode;
                    if (parent) {
                        var siblings = Array.from(parent.children || []);
                        var sameTagSiblings = siblings.filter(function(s) { 
                            return s.tagName === currentElement.tagName; 
                        });
                        if (sameTagSiblings.length > 1) {
                            var index = sameTagSiblings.indexOf(currentElement) + 1;
                            selector += ':nth-of-type(' + index + ')';
                        }
                    }

                    path.unshift(selector);
                    currentElement = currentElement.parentElement;
                }

                return path.join(' > ');
            }

            function getElementLabel(element) {
                var ariaLabel = element.getAttribute('aria-label');
                if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

                var title = element.getAttribute('title');
                if (title && title.trim()) return title.trim();

                var alt = element.getAttribute('alt');
                if (alt && alt.trim()) return alt.trim();

                var textContent = element.textContent ? element.textContent.trim() : '';
                if (textContent && textContent.length > 0 && textContent.length <= 100) {
                    return textContent;
                }

                var placeholder = element.getAttribute('placeholder');
                if (placeholder && placeholder.trim()) return 'Input: ' + placeholder.trim();

                var value = element.value;
                if (value && value.trim()) return 'Input: ' + value.trim();

                var href = element.getAttribute('href');
                if (href) {
                    if (href.startsWith('mailto:')) return 'Email: ' + href.substring(7);
                    if (href.startsWith('tel:')) return 'Phone: ' + href.substring(4);
                    var urlParts = href.split('/').filter(function(p) { return p; });
                    var lastPart = urlParts[urlParts.length - 1];
                    if (lastPart && lastPart !== '#') return 'Link: ' + lastPart;
                }

                var tagName = element.tagName.toLowerCase();
                var type = element.getAttribute('type');
                if (type) return tagName + '[' + type + ']';

                return tagName;
            }

            // MODIFIED: Check if element exists and has basic dimensions (no viewport check)
            function isElementRendered(element) {
                var rect = element.getBoundingClientRect();
                var style = window.getComputedStyle(element);

                return (
                    rect.width > 0 &&
                    rect.height > 0 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0'
                    // REMOVED: viewport position checks
                );
            }

            // Selectors for interactive elements
            var interactiveSelectors = [
                'button',
                'a[href]',
                'input',
                'select',
                'textarea',
                '[role="button"]',
                '[role="link"]',
                '[role="tab"]',
                '[role="menuitem"]',
                '[onclick]',
                '[data-testid]',
                'summary',
                '[tabindex]:not([tabindex="-1"])',
                'label[for]',
                '[style*="cursor: pointer"]',
                '[style*="cursor:pointer"]'
            ];

            var elements = [];
            var processedElements = new Set();
            var elementCounter = 1;

            interactiveSelectors.forEach(function(selector) {
                try {
                    var foundElements = document.querySelectorAll(selector);
                    foundElements.forEach(function(element) {
                        if (processedElements.has(element)) return;
                        processedElements.add(element);

                        // Use modified visibility check
                        if (!isElementRendered(element)) return;

                        var rect = element.getBoundingClientRect();
                        var label = getElementLabel(element);

                        if (rect.width < 5 || rect.height < 5) return;
                        if (!label || label.trim().length === 0) return;

                        var className = '';
                        if (typeof element.className === 'string') {
                            className = element.className;
                        } else if (element.className && typeof element.className === 'object') {
                            className = element.className.baseVal || element.className.toString() || '';
                        }

                        var elementData = {
                            id: 'elem_' + elementCounter++,
                            selector: generateSelector(element),
                            tagName: element.tagName.toLowerCase(),
                            label: label,
                            rect: {
                                x: Math.round(rect.x),
                                y: Math.round(rect.y),
                                width: Math.round(rect.width),
                                height: Math.round(rect.height)
                            },
                            attributes: {
                                id: element.id || '',
                                className: className,
                                href: element.getAttribute('href') || '',
                                type: element.getAttribute('type') || '',
                                role: element.getAttribute('role') || '',
                                'aria-label': element.getAttribute('aria-label') || '',
                                'data-testid': element.getAttribute('data-testid') || ''
                            },
                            isVisible: true
                        };

                        elements.push(elementData);
                    });
                } catch (error) {
                    console.warn('Error processing selector ' + selector + ':', error);
                }
            });

            // Sort by position (top to bottom, left to right)
            elements.sort(function(a, b) {
                if (Math.abs(a.rect.y - b.rect.y) < 10) {
                    return a.rect.x - b.rect.x;
                }
                return a.rect.y - b.rect.y;
            });

            return elements;
        })() 
    `) as InteractiveElement[];

    return elements;
}