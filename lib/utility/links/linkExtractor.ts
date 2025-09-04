import { StageHandObserveResult, LinkInfo } from "../../types.js"
import { Page } from "@browserbasehq/stagehand";

export class UniqueInternalLinkExtractor {
    /**
     * Extract unique internal links from Stagehand observe results
     * Gets one link per unique path on the same domain
     */
    static async getUniqueInternalLinks(
        links: StageHandObserveResult[],
        currentUrl: string,
        page: Page
    ): Promise<StageHandObserveResult[]> {
        const currentDomain = new URL(currentUrl).hostname;
        const currentPath = new URL(currentUrl).pathname;
        const seenPaths = new Set<string>();
        const uniqueLinks: StageHandObserveResult[] = [];

        // Extract URLs from selectors in parallel
        const linkPromises = links.map(async (link) => {
            try {
                const url = await this.extractUrlFromSelector(link.selector, page);
                if (!url) return null;

                const parsedUrl = new URL(url, currentUrl);
                const domain = parsedUrl.hostname;
                const path = parsedUrl.pathname;

                // Only include internal links (same domain) but different paths
                if (domain === currentDomain && path !== currentPath) {
                    return {
                        ...link,
                        extractedUrl: parsedUrl.href,
                        domain: domain,
                        path: path
                    };
                }
                return null;
            } catch (error) {
                console.warn(`Failed to extract URL from selector ${link.selector}:`, error);
                return null;
            }
        });

        const resolvedLinks = await Promise.all(linkPromises);

        // Filter unique paths
        for (const link of resolvedLinks) {
            if (link && !seenPaths.has(link.path)) {
                seenPaths.add(link.path);
                uniqueLinks.push(link);
            }
        }

        return uniqueLinks;
    }

    /**
     * Extract URL from a CSS selector or XPath using Playwright
     */
    private static async extractUrlFromSelector(selector: string, page: Page): Promise<string | null> {
        try {
            const url = await page.evaluate((sel) => {
                let element: Element | null = null;

                // ✅ Handle XPath vs CSS selector properly
                if (sel.startsWith('xpath=')) {
                    const xpath = sel.substring(6); // Remove 'xpath=' prefix
                    try {
                        const result = document.evaluate(
                            xpath,
                            document,
                            null,
                            XPathResult.FIRST_ORDERED_NODE_TYPE,
                            null
                        );
                        element = result.singleNodeValue as Element;
                    } catch (xpathError) {
                        console.warn(`XPath evaluation failed for: ${xpath}`, xpathError);
                        return null;
                    }
                } else {
                    // It's a CSS selector
                    try {
                        element = document.querySelector(sel);
                    } catch (cssError) {
                        console.warn(`CSS selector failed for: ${sel}`, cssError);
                        return null;
                    }
                }

                if (!element) return null;

                // Extract URL from the found element
                if (element.tagName === 'A') {
                    return (element as HTMLAnchorElement).href;
                }

                // Handle elements with data attributes
                const dataHref = element.getAttribute('data-href') ||
                    element.getAttribute('data-url') ||
                    element.getAttribute('data-link');
                if (dataHref) return dataHref;

                // Handle onclick handlers that might contain URLs
                const onclick = element.getAttribute('onclick');
                if (onclick) {
                    const urlMatch = onclick.match(/(?:window\.open|location\.href|goto)\s*\(\s*['"`]([^'"`]+)['"`]/);
                    if (urlMatch) return urlMatch[1];
                }

                // Handle form actions
                if (element.tagName === 'FORM') {
                    return (element as HTMLFormElement).action;
                }

                // Handle button with formaction
                if (element.tagName === 'BUTTON' || element.tagName === 'INPUT') {
                    const formAction = element.getAttribute('formaction');
                    if (formAction) return formAction;
                }

                // Look for closest parent link
                const parentLink = element.closest('a');
                if (parentLink) {
                    return (parentLink as HTMLAnchorElement).href;
                }

                return null;
            }, selector);

            return url;
        } catch (error) {
            console.warn(`Error extracting URL from selector ${selector}:`, error);
            return null;
        }
    }

    /**
     * Get unique internal links by path grouping with better selection logic
     */
    static async getUniqueInternalLinksByPath(
        links: StageHandObserveResult[],
        currentUrl: string,
        page: Page,
        preferredSelectors: string[] = ['a', 'button', '[role="button"]']
    ): Promise<StageHandObserveResult[]> {

        const currentDomain = new URL(currentUrl).hostname;
        const currentPath = new URL(currentUrl).pathname;
        const pathMap = new Map<string, StageHandObserveResult[]>();

        // Group links by path
        const linkPromises = links.map(async (link) => {
            try {
                const url = await this.extractUrlFromSelector(link.selector, page);
                if (!url) return null;

                const parsedUrl = new URL(url, currentUrl);
                const domain = parsedUrl.hostname;
                const path = parsedUrl.pathname;

                // Only process internal links with different paths
                if (domain === currentDomain && path !== currentPath) {
                    return {
                        ...link,
                        extractedUrl: parsedUrl.href,
                        domain: domain,
                        path: path
                    };
                }
                return null;
            } catch (error) {
                return null;
            }
        });

        const resolvedLinks = await Promise.all(linkPromises);

        // Group by path
        for (const link of resolvedLinks) {
            if (link) {
                if (!pathMap.has(link.path)) {
                    pathMap.set(link.path, []);
                }
                pathMap.get(link.path)!.push(link);
            }
        }

        // Select best representative for each path
        const uniqueLinks: StageHandObserveResult[] = [];
        for (const [path, pathLinks] of pathMap) {
            const bestLink = this.selectBestLinkForPath(pathLinks, preferredSelectors);
            if (bestLink) {
                uniqueLinks.push(bestLink);
            }
        }

        return uniqueLinks;
    }

    /**
     * Select the best link from multiple links to the same path
     */
    private static selectBestLinkForPath(
        links: StageHandObserveResult[],
        preferredSelectors: string[]
    ): StageHandObserveResult | null {

        if (links.length === 0) return null;
        if (links.length === 1) return links[0];

        const scoreLink = (link: StageHandObserveResult): number => {
            let score = 0;

            // Prefer certain selector types
            for (let i = 0; i < preferredSelectors.length; i++) {
                if (link.selector.toLowerCase().includes(preferredSelectors[i])) {
                    score += (preferredSelectors.length - i) * 10;
                    break;
                }
            }

            // Prefer links with good descriptions
            if (link.description && link.description.length > 0) {
                score += 5;
                if (link.description.length > 3 && link.description.length < 50) {
                    score += 3;
                }
            }

            // Prefer simple selectors (less nested for XPath)
            if (link.selector.startsWith('xpath=')) {
                const xpathComplexity = (link.selector.match(/\[\d+\]/g) || []).length;
                score -= xpathComplexity;
            } else {
                const selectorComplexity = (link.selector.match(/>/g) || []).length;
                score -= selectorComplexity;
            }

            // Prefer click method over others
            if (link.method === 'click') {
                score += 2;
            }

            return score;
        };

        return links.reduce((best, current) =>
            scoreLink(current) > scoreLink(best) ? current : best
        );
    }

    /**
     * Convert unique internal links to LinkInfo format
     */
    static convertToLinkInfo(
        uniqueLinks: StageHandObserveResult[],
        currentUrl: string
    ): LinkInfo[] {
        return uniqueLinks.map(link => ({
            description: link.description,
            selector: link.selector,
            method: link.method || "click",
            href: this.normalizeUrl(link.selector, currentUrl),
            arguments: link.arguments,
            visited: false,
        }));
    }

    private static normalizeUrl(href: string, base: string): string {
        try {
            const url = new URL(href, base);
            url.hash = "";
            if (url.pathname.endsWith("/") && url.pathname !== "/") {
                url.pathname = url.pathname.slice(0, -1);
            }
            return url.href;
        } catch {
            return href;
        }
    }

    /**
     * Advanced filtering with path pattern matching
     */
    static async getUniqueInternalLinksAdvanced(
        links: StageHandObserveResult[],
        currentUrl: string,
        page: Page,
        options: {
            excludePatterns?: RegExp[];
            includePatterns?: RegExp[];
            maxDepth?: number;
            preferredSelectors?: string[];
        } = {}
    ): Promise<StageHandObserveResult[]> {

        const {
            excludePatterns = [],
            includePatterns = [],
            maxDepth = Infinity,
            preferredSelectors = ['a', 'button', '[role="button"]']
        } = options;

        const currentDomain = new URL(currentUrl).hostname;
        const currentPath = new URL(currentUrl).pathname;
        const currentDepth = currentPath.split('/').filter(p => p.length > 0).length;
        const pathMap = new Map<string, StageHandObserveResult[]>();

        const linkPromises = links.map(async (link) => {
            try {
                const url = await this.extractUrlFromSelector(link.selector, page);
                if (!url) return null;

                const parsedUrl = new URL(url, currentUrl);
                const domain = parsedUrl.hostname;
                const path = parsedUrl.pathname;

                // Only process internal links with different paths
                if (domain !== currentDomain || path === currentPath) {
                    return null;
                }

                // Check depth limit
                const linkDepth = path.split('/').filter(p => p.length > 0).length;
                if (linkDepth > currentDepth + maxDepth) {
                    return null;
                }

                // Check exclude patterns
                if (excludePatterns.some(pattern => pattern.test(path))) {
                    return null;
                }

                // Check include patterns (if any specified)
                if (includePatterns.length > 0 && !includePatterns.some(pattern => pattern.test(path))) {
                    return null;
                }

                return {
                    ...link,
                    extractedUrl: parsedUrl.href,
                    domain: domain,
                    path: path
                };
            } catch (error) {
                return null;
            }
        });

        const resolvedLinks = await Promise.all(linkPromises);

        // Group by path
        for (const link of resolvedLinks) {
            if (link) {
                if (!pathMap.has(link.path)) {
                    pathMap.set(link.path, []);
                }
                pathMap.get(link.path)!.push(link);
            }
        }

        // Select best representative for each path
        const uniqueLinks: StageHandObserveResult[] = [];
        for (const [path, pathLinks] of pathMap) {
            const bestLink = this.selectBestLinkForPath(pathLinks, preferredSelectors);
            if (bestLink) {
                uniqueLinks.push(bestLink);
            }
        }

        return uniqueLinks;
    }
}