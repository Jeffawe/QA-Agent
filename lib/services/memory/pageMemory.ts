import { EndPointTestResult, LinkInfo, PageDetails, UITesterResult } from '../../types.js';

export class PageMemory {
  private pages: Record<string, PageDetails> = {};
  private visitedLinks: Set<string> = new Set();
  private navStack: string[] = [];

  addPage(details: PageDetails) {
    if (!details.url) return;
    const cleanUrl = PageMemory.cleanUrl(details.url);
    if (!this.pages[cleanUrl]) {
      this.pages[cleanUrl] = details;
    } else {
      this.pages[cleanUrl] = {
        ...this.pages[cleanUrl],
        ...details
      }
    }
  }

  public getVisitedLinks(): Set<string> {
    return this.visitedLinks;
  }

  getPageDepth(url: string): number {
    const cleanUrl = PageMemory.cleanUrl(url);
    return this.pages[cleanUrl]?.depth || 0;
  }

  addPageWithURL(url: string, parentUrl: string): string {
    if (!url) throw new Error("No URL provided");
    const cleanUrl = PageMemory.cleanUrl(url);
    if (!this.pages[cleanUrl]) {
      this.pages[cleanUrl] = {
        url: url,
        parentUrl: parentUrl,
        title: "",
        uniqueID: "",
        description: "",
        visited: false,
        links: [],
        depth: 0,
        hasDepth: false
      };
    }

    return cleanUrl;
  }


  /**
   * Checks if a page with the given URL exists in memory.
   *
   * @param {string} url - URL of the page to check for.
   * @returns {boolean} True if the page exists, false otherwise.
   */
  hasPage(url: string): boolean {
    url = PageMemory.cleanUrl(url);
    return !!this.pages[url];
  }

  getPage(url: string): PageDetails {
    const cleanUrl = PageMemory.cleanUrl(url);
    return this.pages[cleanUrl];
  }

  getAllPages(): PageDetails[] {
    return Object.values(this.pages);
  }

  static cleanUrl(url: string): string {
    try {
      const u = new URL(url);

      // Normalize hostname (strip www.)
      const host = u.hostname.replace(/^www\./, "");

      // Normalize path (always start with /, remove trailing / unless root)
      let path = u.pathname;
      if (path !== "/" && path.endsWith("/")) {
        path = path.slice(0, -1); // Remove trailing slash
      }

      return host + path;
    } catch {
      // Fallback for malformed URLs
      let cleaned = url
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("#")[0]
        .split("?")[0];

      // Ensure consistent trailing slash handling
      if (cleaned.endsWith("/") && cleaned.indexOf("/") !== cleaned.length - 1) {
        cleaned = cleaned.slice(0, -1);
      }

      return cleaned;
    }
  }

  addPageWithLinks(details: Omit<PageDetails, 'links'>, links: LinkInfo[]) {
    if (!details.url) return;
    const cleanUrl = PageMemory.cleanUrl(details.url);
    if (!this.pages[cleanUrl]) {
      this.pages[cleanUrl] = {
        visited: false,
        parentUrl: details.parentUrl,
        title: details.title,
        url: details.url,
        screenshot: details.screenshot,
        uniqueID: details.uniqueID,
        description: details.description,
        links: links.map(link => ({ ...link, visited: this.isLinkVisitedAll(link.href || link.description) })),
        depth: details.depth,
        hasDepth: details.hasDepth
      }
    }
  }

  /// This checks if the link is visited throughout the entire crawl
  isLinkVisitedAll(identifier: string) {
    return this.visitedLinks.has(identifier);
  }

  getPageParent(url: string): string {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return "";
    return page.parentUrl;
  }

  getPageParentDepth(url: string): number {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return 0;
    return page.depth;
  }

  updatePageDepth(url: string, increment: number) {
    const key = PageMemory.cleanUrl(url);
    const page = this.pages[key];

    if (page && !page.hasDepth) {
      page.depth += increment;
      page.hasDepth = true;
    }
  }

  markPageVisited(url: string) {
    url = PageMemory.cleanUrl(url);
    if (this.pages[url]) {
      this.pages[url].visited = true;
    }
  }

  isLinkVisited(url: string, identifier: string): boolean {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return false;
    const link = page.links.find(
      l => l.description === identifier || l.href === identifier
    );
    if (!link) return false;
    return link.visited;
  }

  addPageScreenshot(url: string, screenshot: string) {
    url = PageMemory.cleanUrl(url);
    if (this.pages[url]) {
      this.pages[url].screenshot = screenshot;
    }
  }

  addAnalysis(url: string, analysis: any, sessionId: string) {
    url = PageMemory.cleanUrl(url);
    if (this.pages[url]) {
      this.pages[url].analysis = {
        ...this.pages[url].analysis,
        ...analysis
      };
      // crawlMap.recordPage(this.pages[url], sessionId);
    }
  }

  addEndpointResults(url: string, results: EndPointTestResult[]) {
    url = PageMemory.cleanUrl(url);
    if (this.pages[url]) {
      this.pages[url].endpointResults = results;
    } else {
      console.warn(`Page not found in memory for URL: ${url}. Cannot add endpoint results.`);
    }
  }

  ///True if there is a screenshot. False if not or doesn't exist
  hasPageScreenshot(url: string): boolean {
    url = PageMemory.cleanUrl(url);
    return !!this.pages[url]?.screenshot;
  }

  /**
   * Marks a link as visited.
   * If the page or link doesn't exist, does nothing.
   * @param {string} url - URL of the page containing the link to mark as visited.
   * @param {string} identifier - Description or absolute URL of the link to mark as visited.
   */
  markLinkVisited(url: string, identifier: string) {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) {
      console.warn(`Page not found in memory for URL: ${url}. Cannot mark link as visited.`);
      return;
    }
    const link = page.links.find(
      l => l.href === identifier || l.description === identifier
    );
    if (link) {
      link.visited = true;
      this.visitedLinks.add(link.href || link.description);
      console.log(
        "\x1b[32m%s\x1b[0m",
        `Marked link as visited for URL: ${url}. Identifier: ${identifier}`
      )
    } else {
      const linkDescriptions = page.links?.map(l => l.href).join(", ") || "none";

      console.warn(
        "\x1b[33m%s\x1b[0m",
        `Link not found in page for URL: ${url}. Identifier: ${identifier} among links [${linkDescriptions}]. Cannot mark link as visited.`
      );
    }
  }

  /**
   * Marks all links on a page as visited if they have been
   * marked as visited before.
   * If the page doesn't exist, does nothing.
   * @param {string} url - URL of the page containing the links to mark as visited.
   */
  markLinksVisited(url: string) {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return;
    for (const link of page.links) {
      if (this.visitedLinks.has(link.href || link.description)) {
        link.visited = true;
      }
    }
  }

  /**
   * Finds the next unvisited link on a page.
   * If the page doesn't exist or all links have been visited, returns null.
   * @param {string} url - URL of the page to search for unvisited links.
   * @returns {LinkInfo | null} The next unvisited link on the page, or null if none.
   */
  getNextUnvisitedLink(url: string): LinkInfo | null {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return null;
    return page.links.find(link => !link.visited) || null;
  }

  pageExists(url: string): boolean {
    url = PageMemory.cleanUrl(url);
    return !!this.pages[url];
  }

  /**
   * Check if all links on a page have been visited.
   * If the page doesn't exist, returns true.
   * @param {string} url - URL of the page
   * @returns {boolean} true if all links are visited, false if not
   */
  isFullyExplored(url: string): boolean {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return true;
    return page.links.every(link => link.visited);
  }

  /**
   * Removes a link from the page memory
   * If the page doesn't exist, does nothing
   * @param {string} url - URL of the page containing the link to remove
   * @param {string} identifier - Description or absolute URL of the link to remove
   */
  removeLink(url: string, identifier: string) {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return;
    page.links = page.links.filter(link => link.description !== identifier);
  }

  /**
   * Gets all unvisited links on a page
   * If the page doesn't exist, returns an empty array
   * @param {string} url - URL of the page
   * @returns {LinkInfo[]} Unvisited links on the page
   */
  getAllUnvisitedLinks(url: string): LinkInfo[] {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return [];
    return page.links.filter(link => !link.visited);
  }

  setTestResults(url: string, testResults: UITesterResult[]) {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return;
    page.testResults = testResults;
  }

  clear() {
    this.pages = {};
  }

  setAllLinksVisited(url: string) {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return;
    for (const link of page.links) {
      link.visited = true;
      this.visitedLinks.add(link.href || link.description);
    }
  }

  /**
   * Pushes a URL onto the navigation stack.
   * If the URL is the same as the last one on the stack, it is not pushed.
   * @param {string} url - URL to push onto the stack
   */
  pushToStack(url: string) {
    const last = this.navStack[this.navStack.length - 1];
    if (last !== url) {
      this.navStack.push(url);
    }
  }

  /**
   * Pops the last URL from the navigation stack.
   * If the stack is empty, returns undefined.
   * @returns {string | undefined} The last URL on the stack, or undefined if the stack is empty.
   */
  popFromStack(): string | undefined {
    if (this.navStack.length === 0) return undefined;
    return this.navStack.pop();
  }

  getTopOfStack(): string | undefined {
    return this.navStack[this.navStack.length - 1];
  }

  hasStack(): boolean {
    return this.navStack.length > 0;
  }

  /**
   * Checks if a page with the given URL has been visited before.
   * Returns true if the page has been visited, false otherwise.
   * @param {string} url - URL of the page to check for
   * @returns {boolean} True if the page has been visited, false otherwise
   */
  isPageVisited(url: string): boolean {
    url = PageMemory.cleanUrl(url);
    return this.pages[url]?.visited || false;
  }
}

const pageMemory = new PageMemory();
export { pageMemory };