import { createCanvas, loadImage, CanvasRenderingContext2D, Canvas } from '@napi-rs/canvas'
import fs from 'fs';
import path from 'path';
import { InteractiveElement } from '../types.js';
import crypto from 'crypto';

type HashAlgorithm = 'md5' | 'sha1' | 'sha256';
const imageDir = 'images';

interface ComparisonResult {
    similar: boolean;
    distance: number;
    hash1: string;
    hash2: string;
}

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
    showIds: false,
    labelPosition: 'top',
    maxLabelLength: 20
};

export function storeImage(imagePath: string, outputDir: string = imageDir): string {
    const fileName = path.basename(imagePath);
    const outputPath = path.join(outputDir, fileName);
    fs.copyFileSync(imagePath, outputPath);
    return outputPath;
}

export function clearAllImages(outputDir: string = imageDir): void {
    fs.readdirSync(outputDir).forEach(file => {
        const filePath = path.join(outputDir, file);
        fs.unlinkSync(filePath);
    });
}

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
        drawElementAnnotation(ctx, canvas, element, index, opts);
    });

    // Save the annotated image
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
}

function drawElementAnnotation(
    ctx: CanvasRenderingContext2D,
    canvas: Canvas,
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
        drawLabel(ctx, canvas, labelText, rect, opts);
    }

    // Draw a small colored dot to indicate element type
    drawElementTypeIndicator(ctx, element, rect);
}

function drawLabel(
    ctx: CanvasRenderingContext2D,
    canvas: Canvas,
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
    labelX = Math.max(0, Math.min(labelX, canvas.width - textWidth));
    labelY = Math.max(textHeight, Math.min(labelY, canvas.height));

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
    outputDir: string,
    fileName: string
): Promise<void> {
    // Create annotated image
    const annotatedImagePath = path.join(outputDir, fileName);
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
        showIds: false,
        labelPosition: 'top',
        maxLabelLength: 25
    });

    // Create full report
    // await createAnnotationReport(screenshotPath, elements, outputDir);
}

export function getImageHash(imagePath: string, algorithm: HashAlgorithm = 'md5'): string {
    const imageBuffer = fs.readFileSync(imagePath);
    const hash = crypto.createHash(algorithm);
    hash.update(imageBuffer);
    return hash.digest('hex');
}

// Compare two images by exact hash
export function compareImagesExact(imagePath1: string, imagePath2: string): boolean {
    const hash1 = getImageHash(imagePath1);
    const hash2 = getImageHash(imagePath2);
    return hash1 === hash2;
}

// Simple perceptual hash based on image dimensions and basic content
export function getPerceptualHash(imagePath: string): string {
    const imageBuffer = fs.readFileSync(imagePath);

    // Simple approach: hash file size + first/last bytes + some middle bytes
    const size = imageBuffer.length;
    const firstBytes = imageBuffer.slice(0, Math.min(1024, size));
    const lastBytes = imageBuffer.slice(Math.max(0, size - 1024));
    const middleBytes = imageBuffer.slice(Math.floor(size / 2), Math.floor(size / 2) + 1024);

    const combinedBuffer = Buffer.concat([
        Buffer.from(size.toString()),
        firstBytes,
        middleBytes,
        lastBytes
    ]);

    return crypto.createHash('sha256').update(combinedBuffer).digest('hex');
}

// Calculate hamming distance between two hex strings
function hammingDistance(hash1: string, hash2: string): number {
    if (hash1.length !== hash2.length) return Infinity;

    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
        const byte1 = parseInt(hash1.substr(i, 2), 16);
        const byte2 = parseInt(hash2.substr(i, 2), 16);
        const xor = byte1 ^ byte2;

        // Count set bits
        let count = 0;
        let n = xor;
        while (n) {
            count += n & 1;
            n >>= 1;
        }
        distance += count;
        i++; // Skip next character since we processed 2 chars
    }
    return distance;
}

// Compare images by perceptual similarity
export function compareImagesPerceptual(
    imagePath1: string,
    imagePath2: string,
    threshold: number = 50
): ComparisonResult {
    const hash1 = getPerceptualHash(imagePath1);
    const hash2 = getPerceptualHash(imagePath2);

    const distance = hammingDistance(hash1, hash2);

    return {
        similar: distance <= threshold,
        distance: distance,
        hash1: hash1,
        hash2: hash2
    };
}

// Get unique identifier for an image (combines exact and perceptual)
export function getImageIdentifier(imagePath: string): {
    exactHash: string;
    perceptualHash: string;
    filePath: string;
} {
    return {
        exactHash: getImageHash(imagePath),
        perceptualHash: getPerceptualHash(imagePath),
        filePath: imagePath
    };
}

// Check if two images are the same (exact or perceptually similar)
export function areImagesSame(
    imagePath1: string,
    imagePath2: string,
    usePerceptual: boolean = true
): boolean {
    // First try exact match
    if (compareImagesExact(imagePath1, imagePath2)) {
        return true;
    }

    // If not exact and perceptual is enabled, try perceptual match
    if (usePerceptual) {
        const result = compareImagesPerceptual(imagePath1, imagePath2);
        return result.similar;
    }

    return false;
}


