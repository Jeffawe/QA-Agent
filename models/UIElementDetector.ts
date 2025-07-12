import { spawnSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Box, ElementData, Rect, State } from '../types';
import { LogManager } from '../logManager';
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
        LogManager.log(`Python output: ${result.stdout.trim()}`, State.DECIDE, true);
        return JSON.parse(result.stdout.trim());
    } catch (e) {
        console.error('Failed to parse Python output:', result.stdout);
        return [];
    }
}

export const matchBoxes = (openCVBoxes: Box[], domBoxes: ElementData[]) => {
    const matches = [];
    const tolerance = 5; // pixels
    
    for (const cvBox of openCVBoxes) {
        const candidates = domBoxes.filter(domBox => {
            // Check if boxes overlap significantly
            const overlapX = Math.max(0, Math.min(cvBox.x + cvBox.width, domBox.rect.x + domBox.rect.width) - Math.max(cvBox.x, domBox.rect.x));
            const overlapY = Math.max(0, Math.min(cvBox.y + cvBox.height, domBox.rect.y + domBox.rect.height) - Math.max(cvBox.y, domBox.rect.y));
            const overlapArea = overlapX * overlapY;
            
            const cvArea = cvBox.width * cvBox.height;
            const domArea = domBox.rect.width * domBox.rect.height;
            
            // Calculate overlap percentage
            const overlapRatio = overlapArea / Math.min(cvArea, domArea);
            
            return overlapRatio > 0.7; // 70% overlap threshold
        });
        
        if (candidates.length > 0) {
            // Find the best match (highest overlap)
            const bestMatch = candidates.reduce((best, current) => {
                const bestOverlap = calculateOverlap(cvBox, best.rect);
                const currentOverlap = calculateOverlap(cvBox, current.rect);
                return currentOverlap > bestOverlap ? current : best;
            });
            
            matches.push({
                openCVBox: cvBox,
                domElement: bestMatch,
                confidence: calculateOverlap(cvBox, bestMatch.rect)
            });
        }
    }
    
    return matches;
};

const calculateOverlap = (box1: Rect, box2: Rect) => {
    const overlapX = Math.max(0, Math.min(box1.x + box1.width, box2.x + box2.width) - Math.max(box1.x, box2.x));
    const overlapY = Math.max(0, Math.min(box1.y + box1.height, box2.y + box2.height) - Math.max(box1.y, box2.y));
    const overlapArea = overlapX * overlapY;
    
    const area1 = box1.width * box1.height;
    const area2 = box2.width * box2.height;
    
    return overlapArea / Math.min(area1, area2);
}

export const getDOMBoundingBoxes = async (page: Page): Promise<ElementData[]> => {
    return await page.evaluate(() => {
        const elements: ElementData[] = [];
        const allElements = document.querySelectorAll('*');
        
        allElements.forEach((element, index) => {
            const rect = element.getBoundingClientRect();
            
            // Skip elements that are not visible or too small
            if (rect.width < 5 || rect.height < 5 || 
                rect.x < 0 || rect.y < 0 ||
                getComputedStyle(element).display === 'none' ||
                getComputedStyle(element).visibility === 'hidden') {
                return;
            }
            
            // Generate a reliable selector
            const selector = generateSelector(element);
            
            elements.push({
                index: index,
                selector: selector,
                tagName: element.tagName.toLowerCase(),
                rect: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                },
                text: element.textContent?.trim().substring(0, 100) || '',
                isClickable: isClickableElement(element),
                attributes: {
                    id: element.id || '',
                    className: element.className || '',
                    'aria-label': element.getAttribute('aria-label') || '',
                    'data-testid': element.getAttribute('data-testid') || '',
                    href: element.getAttribute('href') || '',
                    type: element.getAttribute('type') || ''
                }
            });
        });
        
        return elements;
        
        function isClickableElement(element: Element): boolean {
            const clickableTags = ['button', 'a', 'input', 'select', 'textarea'];
            const clickableTypes = ['submit', 'button', 'reset'];
            
            return clickableTags.includes(element.tagName.toLowerCase()) ||
                   clickableTypes.includes((element as HTMLInputElement).type) ||
                   element.hasAttribute('onclick') ||
                   element.getAttribute('role') === 'button' ||
                   getComputedStyle(element).cursor === 'pointer';
        }
        
        function generateSelector(element: Element): string {
            // Try ID first
            if (element.id) return `#${element.id}`;
            
            // Try data-testid
            if (element.getAttribute('data-testid')) {
                return `[data-testid="${element.getAttribute('data-testid')}"]`;
            }
            
            // Try unique class combination
            if (element.className) {
                const classes = element.className.split(' ').filter(c => c);
                if (classes.length > 0) {
                    const classSelector = '.' + classes.join('.');
                    // Check if it's unique
                    if (document.querySelectorAll(classSelector).length === 1) {
                        return classSelector;
                    }
                }
            }
            
            // Generate nth-child path as fallback
            return generateNthChildPath(element);
        }
        
        function generateNthChildPath(element: Element): string {
            if (element === document.body) return 'body';
            
            const path: string[] = [];
            let currentElement: Element | null = element;
            
            while (currentElement && currentElement !== document.body) {
                let selector = currentElement.tagName.toLowerCase();
                if (currentElement.id) {
                    selector += `#${currentElement.id}`;
                    path.unshift(selector);
                    break;
                }
                
                const siblings = Array.from(currentElement.parentNode?.children || []);
                const sameTagSiblings = siblings.filter(s => s.tagName === currentElement!.tagName);
                if (sameTagSiblings.length > 1) {
                    const index = sameTagSiblings.indexOf(currentElement) + 1;
                    selector += `:nth-of-type(${index})`;
                }
                
                path.unshift(selector);
                currentElement = currentElement.parentElement;
            }
            
            return path.join(' > ');
        }
    });
};
