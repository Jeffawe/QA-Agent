import { createCanvas, loadImage, CanvasRenderingContext2D } from 'canvas';
import fs from 'fs';
import path from 'path';
import { InteractiveElement } from '../types';

interface AnnotationOptions {
    boxColor: string;
    textColor: string;
    backgroundColor: string;
    fontSize: number;
    borderWidth: number;
    showLabels: boolean;
    showIds: boolean;
    labelPosition: 'top' | 'bottom' | 'center';
    maxLabelLength: number;
}

const DEFAULT_OPTIONS: AnnotationOptions = {
    boxColor: '#ff0000',
    textColor: '#ffffff',
    backgroundColor: '#000000',
    fontSize: 12,
    borderWidth: 2,
    showLabels: true,
    showIds: true,
    labelPosition: 'top',
    maxLabelLength: 20
};

export async function annotateImage(
    imagePath: string,
    elements: InteractiveElement[],
    outputPath: string,
    options: Partial<AnnotationOptions> = {}
): Promise<void> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    // Load the original image
    const image = await loadImage(imagePath);
    
    // Create canvas with same dimensions as image
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    
    // Draw the original image
    ctx.drawImage(image, 0, 0);
    
    // Set up drawing styles
    ctx.strokeStyle = opts.boxColor;
    ctx.lineWidth = opts.borderWidth;
    ctx.fillStyle = opts.textColor;
    ctx.font = `${opts.fontSize}px Arial`;
    
    // Draw annotations for each element
    elements.forEach((element, index) => {
        drawElementAnnotation(ctx, element, index, opts);
    });
    
    // Save the annotated image
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
    
    console.log(`Annotated image saved to: ${outputPath}`);
}

function drawElementAnnotation(
    ctx: CanvasRenderingContext2D,
    element: InteractiveElement,
    index: number,
    opts: AnnotationOptions
): void {
    const { rect, label, id, tagName } = element;
    
    // Draw bounding box
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    
    // Prepare label text
    let labelText = '';
    if (opts.showIds) {
        labelText += `${index + 1}. `;
    }
    if (opts.showLabels) {
        const truncatedLabel = label.length > opts.maxLabelLength 
            ? label.substring(0, opts.maxLabelLength) + '...' 
            : label;
        labelText += truncatedLabel;
    }
    
    if (labelText) {
        drawLabel(ctx, labelText, rect, opts);
    }
    
    // Draw a small colored dot to indicate element type
    drawElementTypeIndicator(ctx, element, rect);
}

function drawLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    rect: { x: number; y: number; width: number; height: number },
    opts: AnnotationOptions
): void {
    const textMetrics = ctx.measureText(text);
    const textWidth = textMetrics.width;
    const textHeight = opts.fontSize;
    
    // Calculate label position
    let labelX = rect.x;
    let labelY = rect.y;
    
    switch (opts.labelPosition) {
        case 'top':
            labelY = rect.y - textHeight - 2;
            break;
        case 'bottom':
            labelY = rect.y + rect.height + textHeight + 2;
            break;
        case 'center':
            labelX = rect.x + (rect.width - textWidth) / 2;
            labelY = rect.y + (rect.height + textHeight) / 2;
            break;
    }
    
    // Ensure label doesn't go off screen
    labelX = Math.max(0, Math.min(labelX, ctx.canvas.width - textWidth));
    labelY = Math.max(textHeight, Math.min(labelY, ctx.canvas.height));
    
    // Draw background rectangle for text
    const padding = 4;
    ctx.fillStyle = opts.backgroundColor;
    ctx.fillRect(
        labelX - padding,
        labelY - textHeight - padding,
        textWidth + (padding * 2),
        textHeight + (padding * 2)
    );
    
    // Draw text
    ctx.fillStyle = opts.textColor;
    ctx.fillText(text, labelX, labelY);
}

function drawElementTypeIndicator(
    ctx: CanvasRenderingContext2D,
    element: InteractiveElement,
    rect: { x: number; y: number; width: number; height: number }
): void {
    const indicatorSize = 8;
    const indicatorX = rect.x + rect.width - indicatorSize - 2;
    const indicatorY = rect.y + 2;
    
    // Choose color based on element type
    let indicatorColor: string;
    switch (element.tagName) {
        case 'button':
            indicatorColor = '#4CAF50'; // Green
            break;
        case 'a':
            indicatorColor = '#2196F3'; // Blue
            break;
        case 'input':
            indicatorColor = '#FF9800'; // Orange
            break;
        case 'select':
            indicatorColor = '#9C27B0'; // Purple
            break;
        case 'textarea':
            indicatorColor = '#607D8B'; // Blue Grey
            break;
        default:
            indicatorColor = '#F44336'; // Red
    }
    
    ctx.fillStyle = indicatorColor;
    ctx.fillRect(indicatorX, indicatorY, indicatorSize, indicatorSize);
}

// Alternative function for creating a detailed annotation report
export async function createAnnotationReport(
    imagePath: string,
    elements: InteractiveElement[],
    outputDir: string
): Promise<void> {
    // Create annotated image
    const annotatedImagePath = path.join(outputDir, 'annotated_screenshot.png');
    await annotateImage(imagePath, elements, annotatedImagePath);
    
    // Create JSON report
    const reportPath = path.join(outputDir, 'annotation_report.json');
    const report = {
        timestamp: new Date().toISOString(),
        originalImage: imagePath,
        annotatedImage: annotatedImagePath,
        totalElements: elements.length,
        elements: elements.map((element, index) => ({
            index: index + 1,
            ...element
        }))
    };
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    // Create markdown report
    const markdownPath = path.join(outputDir, 'annotation_report.md');
    const markdownContent = generateMarkdownReport(elements);
    fs.writeFileSync(markdownPath, markdownContent);
    
    console.log(`Annotation report created in: ${outputDir}`);
}

function generateMarkdownReport(elements: InteractiveElement[]): string {
    let markdown = '# Interactive Elements Report\n\n';
    markdown += `Generated on: ${new Date().toLocaleString()}\n\n`;
    markdown += `Total elements found: ${elements.length}\n\n`;
    
    markdown += '## Elements List\n\n';
    elements.forEach((element, index) => {
        markdown += `### ${index + 1}. ${element.label}\n\n`;
        markdown += `- **Tag**: ${element.tagName}\n`;
        markdown += `- **Selector**: \`${element.selector}\`\n`;
        markdown += `- **Position**: (${element.rect.x}, ${element.rect.y})\n`;
        markdown += `- **Size**: ${element.rect.width}x${element.rect.height}\n`;
        
        if (element.attributes.id) {
            markdown += `- **ID**: ${element.attributes.id}\n`;
        }
        if (element.attributes.className) {
            markdown += `- **Classes**: ${element.attributes.className}\n`;
        }
        if (element.attributes.href) {
            markdown += `- **Link**: ${element.attributes.href}\n`;
        }
        if (element.attributes['aria-label']) {
            markdown += `- **ARIA Label**: ${element.attributes['aria-label']}\n`;
        }
        
        markdown += '\n';
    });
    
    return markdown;
}

// Usage example:
export async function processScreenshot(
    screenshotPath: string,
    elements: InteractiveElement[],
    outputDir: string = './images'
): Promise<void> {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Create annotated image with custom options
    const annotatedImagePath = path.join(outputDir, `annotated_${path.basename(screenshotPath)}`);
    await annotateImage(screenshotPath, elements, annotatedImagePath, {
        boxColor: '#ff0000',
        textColor: '#ffffff',
        backgroundColor: '#000000',
        fontSize: 14,
        borderWidth: 2,
        showLabels: true,
        showIds: true,
        labelPosition: 'top',
        maxLabelLength: 25
    });
    
    // Create full report
    await createAnnotationReport(screenshotPath, elements, outputDir);
}