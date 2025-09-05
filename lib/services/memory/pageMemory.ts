import { LinkInfo, PageDetails } from '../../types.js';
import { CrawlMap } from '../../utility/crawlMap.js';

export class PageMemory {
  private static pages: Record<string, PageDetails> = {};
  private static navStack: string[] = [];

  static addPage(details: PageDetails) {
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

  static addPageWithURL(url: string): string {
    if (!url) throw new Error("No URL provided");
    const cleanUrl = PageMemory.cleanUrl(url);
    if (!this.pages[cleanUrl]) {
      this.pages[cleanUrl] = {
        url: url,
        title: "",
        uniqueID: "",
        description: "",
        visited: false,
        links: []
      };
    }

    return cleanUrl;
  }

  // Check if a page exists
  // @returns {boolean} true if page exists
  static hasPage(url: string): boolean {
    url = PageMemory.cleanUrl(url);
    return !!this.pages[url];
  }

  static getPage(url: string): PageDetails {
    const cleanUrl = PageMemory.cleanUrl(url);
    return this.pages[cleanUrl];
  }

  static getAllPages(): PageDetails[] {
    return Object.values(this.pages);
  }

  static cleanUrl(url: string) {
    try {
      const u = new URL(url);

      // Normalize hostname (strip www.)
      let host = u.hostname.replace(/^www\./, "");

      // Normalize path (remove trailing slash unless it's root)
      let path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");

      // Ignore search params and fragments
      return host + path;
    } catch {
      // Fallback for malformed inputs like "https:jeffawe.com/"
      return url
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "")
        .split("#")[0]
        .split("?")[0];
    }
  }

  static addPage2(details: Omit<PageDetails, 'links'>, links: Omit<LinkInfo, 'visited'>[]) {
    if (!details.url) return;
    const cleanUrl = PageMemory.cleanUrl(details.url);
    if (!this.pages[cleanUrl]) {
      this.pages[cleanUrl] = {
        visited: false,
        title: details.title,
        url: details.url,
        screenshot: details.screenshot,
        uniqueID: details.uniqueID,
        description: details.description,
        links: links.map(link => ({ ...link, visited: false })),
      }
    }
  }

  static markPageVisited(url: string) {
    url = PageMemory.cleanUrl(url);
    if (this.pages[url]) {
      this.pages[url].visited = true;
    }
  }

  static isLinkVisited(url: string, identifier: string): boolean {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return false;
    const link = page.links.find(
      l => l.description === identifier || l.href === identifier
    );
    if (!link) return false;
    return link.visited;
  }

  static addPageScreenshot(url: string, screenshot: string) {
    url = PageMemory.cleanUrl(url);
    if (this.pages[url]) {
      this.pages[url].screenshot = screenshot;
    }
  }

  static addAnalysis(url: string, analysis: any, sessionId: string) {
    url = PageMemory.cleanUrl(url);
    if (this.pages[url]) {
      this.pages[url].analysis = {
        ...this.pages[url].analysis,
        ...analysis
      };
      CrawlMap.recordPage(this.pages[url], sessionId);
    }
  }

  ///True if there is a screenshot. False if not or doesn't exist
  static hasPageScreenshot(url: string): boolean {
    url = PageMemory.cleanUrl(url);
    return !!this.pages[url]?.screenshot;
  }

  static markLinkVisited(url: string, identifier: string) {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return;
    const link = page.links.find(
      l => l.description === identifier || l.href === identifier
    );
    if (link) {
      link.visited = true;
    }
  }

  static getNextUnvisitedLink(url: string): LinkInfo | null {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return null;
    return page.links.find(link => !link.visited) || null;
  }

  static pageExists(url: string): boolean {
    url = PageMemory.cleanUrl(url);
    return !!this.pages[url];
  }

  static isFullyExplored(url: string): boolean {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return true;
    return page.links.every(link => link.visited);
  }

  static removeLink(url: string, identifier: string) {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return;
    page.links = page.links.filter(link => link.description !== identifier);
  }

  static getAllUnvisitedLinks(url: string): LinkInfo[] {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return [];
    return page.links.filter(link => !link.visited);
  }

  static setAllLinksVisited(url: string) {
    url = PageMemory.cleanUrl(url);
    const page = this.pages[url];
    if (!page) return;
    page.links.forEach(link => link.visited = true);
  }

  static pushToStack(url: string) {
    this.navStack.push(url);
  }

  static popFromStack(): string | undefined {
    if (this.navStack.length === 0) return undefined;
    return this.navStack.pop();
  }

  static hasStack(): boolean {
    return this.navStack.length > 0;
  }

  static isPageVisited(url: string): boolean {
    url = PageMemory.cleanUrl(url);
    return this.pages[url]?.visited || false;
  }
}