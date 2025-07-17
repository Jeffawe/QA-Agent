import { LinkInfo, PageDetails } from '../../types';
import { CrawlMap } from '../../utility/crawlMap';
import { LogManager } from '../../utility/logManager';

export class PageMemory {
  public static pages: Record<string, PageDetails> = {};
  private static navStack: string[] = [];

  static addPage(details: PageDetails) {
    if (!details.url) return;
    if (!this.pages[details.url]) {
      this.pages[details.url] = details;
    }
  }

  static addPage2(details: Omit<PageDetails, 'links'>, links: Omit<LinkInfo, 'visited'>[]) {
    if (!details.url) return;
    if (!this.pages[details.url]) {
      this.pages[details.url] = {
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
    if (this.pages[url]) {
      this.pages[url].visited = true;
    }
  }

  static addPageScreenshot(url: string, screenshot: string) {
    if (this.pages[url]) {
      this.pages[url].screenshot = screenshot;
    }
  }

  static addAnalysis(url: string, analysis: any) {
    if (this.pages[url]) {
      this.pages[url].analysis = analysis;
      CrawlMap.recordPage(this.pages[url]);
    }
  }

  ///True if there is a screenshot. False if not or doesn't exist
  static hasPageScreenshot(url: string): boolean {
    return !!this.pages[url]?.screenshot;
  }

  static markLinkVisited(url: string, identifier: string) {
    const page = this.pages[url];
    if (!page) return;
    const link = page.links.find(
      l => l.text === identifier || l.href === identifier
    );
    if (link){
      LogManager.log(`Marking link ${link.href} for page ${url} as visited`, 'Crawler.ACT', false);
      link.visited = true;
    }
  }

  static getNextUnvisitedLink(url: string): LinkInfo | null {
    const page = this.pages[url];
    if (!page) return null;
    return page.links.find(link => !link.visited) || null;
  }

  static pageExists(url: string): boolean {
    return !!this.pages[url];
  }

  static isFullyExplored(url: string): boolean {
    const page = this.pages[url];
    if (!page) return true;
    return page.links.every(link => link.visited);
  }

  static getAllUnvisitedLinks(url: string): LinkInfo[] {
    const page = this.pages[url];
    if (!page) return [];
    return page.links.filter(link => !link.visited);
  }

  static pushToStack(url: string) {
    this.navStack.push(url);
  }

  static popFromStack(): string | undefined {
    return this.navStack.pop();
  }

  static hasStack(): boolean {
    return this.navStack.length > 0;
  }

  static isPageVisited(url: string): boolean {
    return this.pages[url]?.visited || false;
  }
}