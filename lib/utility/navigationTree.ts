import * as fs from 'fs';
import { join, isAbsolute } from "path";
import { LogManager } from './logManager.js';

interface PageNode {
    type: 'page';
    name: string;
    description: string;
    url: string;
    extraInfo: Record<string, any>;
    timestamp: string;
    actions: ActionNode[];
    visitNumber: number;
}

interface ActionNode {
    type: 'action';
    actionType: string;
    description: string;
    details: Record<string, any>;
    timestamp: string;
}

interface NavigationStats {
    totalPages: number;
    totalActions: number;
    uniquePages: number;
    averageActionsPerPage: string;
}

interface ExportData {
    tree: PageNode[];
    stats: NavigationStats;
    exportTimestamp: string;
}

class NavigationTree {
    private static instance: NavigationTree | null = null;
    private static tree: PageNode[] = [];
    private static currentPath: number[] = [];
    private static pageVisitCounts: Map<string, number> = new Map();
    private static outputFile: string = 'navigation_tree.md';

    /**
     * Initialize the navigation tree with optional output file path
     */
    static initialize(outputFilePath: string = "logs/navigation_tree.md"): void {
        const fullPath = isAbsolute(outputFilePath)
            ? outputFilePath
            : join(LogManager.PROJECT_ROOT, outputFilePath);

        this.outputFile = fullPath;
        this.tree = [];
        this.currentPath = [];
        this.pageVisitCounts.clear();
        this.updateMarkdownFile();
    }

    /**
     * Add a new page to the navigation tree
     */
    static addPage(name: string, description: string, url: string, extraInfo: Record<string, any> = {}): PageNode {
        // Track visit count for this page
        const visitKey = `${name}_${url}`;
        const visitCount = (this.pageVisitCounts.get(visitKey) || 0) + 1;
        this.pageVisitCounts.set(visitKey, visitCount);

        const pageNode: PageNode = {
            type: 'page',
            name: visitCount > 1 ? `${name} (Visit ${visitCount})` : name,
            description,
            url,
            extraInfo,
            timestamp: new Date().toISOString(),
            actions: [], // Sub-tree for page actions
            visitNumber: visitCount
        };

        this.tree.push(pageNode);
        this.currentPath = [this.tree.length - 1]; // Update current path to this page
        this.updateMarkdownFile();

        return pageNode;
    }

    /**
     * Add an action to the current page (form submission, modal operations, etc.)
     */
    static addAction(actionType: string, description: string, details: Record<string, any> = {}): ActionNode {
        if (this.currentPath.length === 0) {
            throw new Error('No current page to add action to. Call addPage() first.');
        }

        const currentPageIndex = this.currentPath[0];
        const currentPage = this.tree[currentPageIndex];

        const actionNode: ActionNode = {
            type: 'action',
            actionType,
            description,
            details,
            timestamp: new Date().toISOString()
        };

        currentPage.actions.push(actionNode);
        this.updateMarkdownFile();

        return actionNode;
    }

    /**
     * Add a form submission action
     */
    static addFormSubmission(formName: string, formData: Record<string, any> = {}, result: string = 'success'): ActionNode {
        return this.addAction('form_submit', `Form submission: ${formName}`, {
            formName,
            formData,
            result
        });
    }

    /**
     * Add a modal operation (open/close)
     */
    static addModalOperation(modalName: string, operation: 'open' | 'close', modalInfo: Record<string, any> = {}): ActionNode {
        return this.addAction('modal_operation', `Modal ${operation}: ${modalName}`, {
            modalName,
            operation,
            modalInfo
        });
    }

    /**
     * Add a click action
     */
    static addClick(element: string, description: string, elementInfo: Record<string, any> = {}): ActionNode {
        return this.addAction('click', `Click: ${description}`, {
            element,
            elementInfo
        });
    }

    /**
     * Get the current page node
     */
    static getCurrentPage(): PageNode | null {
        if (this.currentPath.length === 0) return null;
        return this.tree[this.currentPath[0]];
    }

    /**
     * Get the full navigation tree
     */
    static getTree(): PageNode[] {
        return this.tree;
    }

    /**
     * Get navigation statistics
     */
    static getStats(): NavigationStats {
        const totalPages = this.tree.length;
        const totalActions = this.tree.reduce((sum, page) => sum + page.actions.length, 0);
        const uniquePages = new Set(this.tree.map(page => page.url)).size;

        return {
            totalPages,
            totalActions,
            uniquePages,
            averageActionsPerPage: totalPages > 0 ? (totalActions / totalPages).toFixed(2) : '0'
        };
    }

    /**
     * Generate markdown representation of the navigation tree
     */
    static generateMarkdown(): string {
        const stats = this.getStats();
        let markdown = `# Navigation Tree\n\n`;
        markdown += `**Generated:** ${new Date().toISOString()}\n\n`;
        markdown += `## Statistics\n`;
        markdown += `- Total Pages Visited: ${stats.totalPages}\n`;
        markdown += `- Unique Pages: ${stats.uniquePages}\n`;
        markdown += `- Total Actions: ${stats.totalActions}\n`;
        markdown += `- Average Actions per Page: ${stats.averageActionsPerPage}\n\n`;

        markdown += `## Navigation Flow\n\n`;

        this.tree.forEach((page, index) => {
            markdown += `### ${index + 1}. ${page.name}\n`;
            markdown += `- **URL:** ${page.url}\n`;
            markdown += `- **Description:** ${page.description}\n`;
            markdown += `- **Timestamp:** ${page.timestamp}\n`;

            if (Object.keys(page.extraInfo).length > 0) {
                markdown += `- **Extra Info:** ${JSON.stringify(page.extraInfo, null, 2)}\n`;
            }

            if (page.actions.length > 0) {
                markdown += `\n#### Actions on this page:\n`;
                page.actions.forEach((action, actionIndex) => {
                    markdown += `${actionIndex + 1}. **${action.actionType.toUpperCase()}** - ${action.description}\n`;
                    markdown += `   - *Timestamp:* ${action.timestamp}\n`;
                    if (Object.keys(action.details).length > 0) {
                        markdown += `   - *Details:* ${JSON.stringify(action.details, null, 2)}\n`;
                    }
                });
            }

            markdown += `\n---\n\n`;
        });

        return markdown;
    }

    /**
     * Update the markdown file with current navigation tree
     */
    static updateMarkdownFile(): void {
        try {
            const markdown = this.generateMarkdown();
            fs.writeFileSync(this.outputFile, markdown, 'utf8');
        } catch (error) {
            console.error('Error updating markdown file:', error);
        }
    }

    /**
     * Export the navigation tree to JSON
     */
    static exportToJSON(filePath: string | null = null): string {
        const exportData: ExportData = {
            tree: this.tree,
            stats: this.getStats(),
            exportTimestamp: new Date().toISOString()
        };

        const jsonString = JSON.stringify(exportData, null, 2);

        if (filePath) {
            try {
                fs.writeFileSync(filePath, jsonString, 'utf8');
            } catch (error) {
                console.error('Error saving JSON file:', error);
            }
        }

        return jsonString;
    }

    /**
     * Clear the navigation tree
     */
    static clear(): void {
        this.tree = [];
        this.currentPath = [];
        this.pageVisitCounts.clear();
        this.updateMarkdownFile();
    }

    /**
     * Find pages by URL
     */
    static findPagesByURL(url: string): PageNode[] {
        return this.tree.filter(page => page.url === url);
    }

    /**
     * Find pages by name
     */
    static findPagesByName(name: string): PageNode[] {
        return this.tree.filter(page =>
            page.name.toLowerCase().includes(name.toLowerCase())
        );
    }

    /**
     * Get the navigation path as a simple array of page names
     */
    static getNavigationPath(): string[] {
        return this.tree.map(page => page.name);
    }
}

export default NavigationTree;

// Example usage (commented out):
/*
// Initialize the navigation tree
NavigationTree.initialize('my_navigation_log.md');

// Add pages as agent navigates
NavigationTree.addPage('Home Page', 'Main landing page', 'https://example.com/', {
    loadTime: '2.3s',
    elements: ['header', 'nav', 'main', 'footer']
});

NavigationTree.addClick('login-button', 'Clicked login button', {
    selector: '#login-btn',
    position: { x: 100, y: 200 }
});

NavigationTree.addModalOperation('Login Modal', 'open', {
    modalId: 'login-modal',
    size: 'medium'
});

NavigationTree.addFormSubmission('Login Form', {
    username: 'testuser',
    password: '[HIDDEN]'
}, 'success');

NavigationTree.addModalOperation('Login Modal', 'close');

// Navigate to another page
NavigationTree.addPage('Dashboard', 'User dashboard after login', 'https://example.com/dashboard', {
    userRole: 'admin',
    widgets: ['stats', 'recent-activity', 'notifications']
});

// Later, navigate back to home page (will be marked as Visit 2)
NavigationTree.addPage('Home Page', 'Returned to home page', 'https://example.com/', {
    returnReason: 'navigation'
});

// Get current stats
console.log(NavigationTree.getStats());

// Export to JSON
NavigationTree.exportToJSON('navigation_export.json');
*/