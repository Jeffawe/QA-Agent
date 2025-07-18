import sys
import cv2
import json
import numpy as np
import pytesseract

# Input: image path from Node.js
if len(sys.argv) < 2:
    print(json.dumps([]))
    sys.exit(0)

image_path = sys.argv[1]

# Load and preprocess image
image = cv2.imread(image_path)
if image is None:
    print(json.dumps([]))
    sys.exit(1)

# Convert to different color spaces for better detection
gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

# Method 1: Enhanced edge detection with multiple thresholds
def detect_edges_multi_threshold(gray):
    boxes = []
    # Try multiple Canny thresholds
    for low, high in [(30, 100), (50, 150), (70, 200)]:
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, low, high)
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for contour in contours:
            approx = cv2.approxPolyDP(contour, 0.02 * cv2.arcLength(contour, True), True)
            area = cv2.contourArea(contour)
            if area > 500 and len(approx) >= 4:  # Relaxed polygon requirement
                x, y, w, h = cv2.boundingRect(approx)
                # Filter by aspect ratio and size
                if w > 30 and h > 30 and w/h < 10 and h/w < 10:
                    boxes.append({"x": x, "y": y, "width": w, "height": h})
                    
    return boxes

# Method 2: Template matching for common UI patterns
def detect_rectangular_regions(gray):
    boxes = []
    # Create simple rectangular kernels
    for size in [3, 5, 7]:
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (size, size))
        
        # Morphological operations to enhance rectangular shapes
        morph = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel)
        morph = cv2.morphologyEx(morph, cv2.MORPH_OPEN, kernel)
        
        # Find contours
        contours, _ = cv2.findContours(morph, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for contour in contours:
            area = cv2.contourArea(contour)
            if area > 1000:
                x, y, w, h = cv2.boundingRect(contour)
                # Check if it's roughly rectangular
                contour_area = cv2.contourArea(contour)
                bbox_area = w * h
                if contour_area / bbox_area > 0.7:  # At least 70% rectangular
                    boxes.append({"x": x, "y": y, "width": w, "height": h})
    return boxes

# Method 3: Adaptive thresholding for UI elements
def detect_adaptive_threshold(gray):
    boxes = []
    # Apply adaptive thresholding
    adaptive = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                   cv2.THRESH_BINARY, 11, 2)
    
    # Find contours
    contours, _ = cv2.findContours(adaptive, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    for contour in contours:
        area = cv2.contourArea(contour)
        if area > 500:
            x, y, w, h = cv2.boundingRect(contour)
            if w > 20 and h > 20:  # Minimum size
                boxes.append({"x": x, "y": y, "width": w, "height": h})
    return boxes

# Method 4: Color-based detection (for colored UI elements)
def detect_color_regions(image, hsv):
    boxes = []
    # Define color ranges for common UI elements
    color_ranges = [
        # Blue range
        (np.array([100, 50, 50]), np.array([130, 255, 255])),
        # Green range  
        (np.array([40, 50, 50]), np.array([80, 255, 255])),
        # Red range
        (np.array([0, 50, 50]), np.array([20, 255, 255])),
        # Gray/white range
        (np.array([0, 0, 200]), np.array([180, 30, 255]))
    ]
    
    for lower, upper in color_ranges:
        mask = cv2.inRange(hsv, lower, upper)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for contour in contours:
            area = cv2.contourArea(contour)
            if area > 1000:
                x, y, w, h = cv2.boundingRect(contour)
                boxes.append({"x": x, "y": y, "width": w, "height": h})
    return boxes

# Method 5: Line detection for UI boundaries
def detect_lines_boxes(gray):
    boxes = []
    # Detect lines using HoughLinesP
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=100, minLineLength=30, maxLineGap=10)
    
    if lines is not None:
        # Group lines to form rectangles
        horizontal_lines = []
        vertical_lines = []
        
        for line in lines:
            x1, y1, x2, y2 = line[0]
            if abs(y2 - y1) < 10:  # Horizontal line
                horizontal_lines.append((min(x1, x2), max(x1, x2), y1))
            elif abs(x2 - x1) < 10:  # Vertical line
                vertical_lines.append((min(y1, y2), max(y1, y2), x1))
        
        # Try to form rectangles from line intersections
        # This is a simplified approach - you might need more sophisticated logic
        for h_line in horizontal_lines:
            for v_line in vertical_lines:
                # Check if lines could form a rectangle
                if abs(h_line[2] - v_line[0]) < 20 or abs(h_line[2] - v_line[1]) < 20:
                    x, y = v_line[2], h_line[2]
                    w, h = abs(h_line[1] - h_line[0]), abs(v_line[1] - v_line[0])
                    if w > 30 and h > 30:
                        boxes.append({"x": x, "y": y, "width": w, "height": h})
    
    return boxes

# Combine all detection methods
all_boxes = []
all_boxes.extend(detect_edges_multi_threshold(gray))
all_boxes.extend(detect_rectangular_regions(gray))
all_boxes.extend(detect_adaptive_threshold(gray))
all_boxes.extend(detect_color_regions(image, hsv))
all_boxes.extend(detect_lines_boxes(gray))

# Remove duplicates and overlapping boxes
def remove_overlapping_boxes(boxes, overlap_threshold=0.5):
    if not boxes:
        return []
    
    # Sort by area (largest first)
    boxes = sorted(boxes, key=lambda x: x['width'] * x['height'], reverse=True)
    
    def calculate_overlap(box1, box2):
        x1, y1, w1, h1 = box1['x'], box1['y'], box1['width'], box1['height']
        x2, y2, w2, h2 = box2['x'], box2['y'], box2['width'], box2['height']
        
        # Calculate intersection
        left = max(x1, x2)
        top = max(y1, y2)
        right = min(x1 + w1, x2 + w2)
        bottom = min(y1 + h1, y2 + h2)
        
        if left < right and top < bottom:
            intersection = (right - left) * (bottom - top)
            area1 = w1 * h1
            area2 = w2 * h2
            union = area1 + area2 - intersection
            return intersection / union
        return 0
    
    filtered_boxes = []
    for box in boxes:
        is_duplicate = False
        for existing_box in filtered_boxes:
            if calculate_overlap(box, existing_box) > overlap_threshold:
                is_duplicate = True
                break
        if not is_duplicate:
            filtered_boxes.append(box)
    
    return filtered_boxes

# Filter and clean up boxes
final_boxes = remove_overlapping_boxes(all_boxes)

# Additional filtering based on UI characteristics
def filter_ui_boxes(boxes):
    filtered = []
    for box in boxes:
        w, h = box['width'], box['height']
        # Filter by reasonable UI element sizes and ratios
        if (w >= 50 and h >= 30 and  # Minimum size
            w <= image.shape[1] * 0.9 and h <= image.shape[0] * 0.9 and  # Not too large
            w/h <= 15 and h/w <= 15):  # Reasonable aspect ratio
            filtered.append(box)
    return filtered

final_boxes = filter_ui_boxes(final_boxes)
labeled_boxes = []


def get_color_fingerprint(roi):
    # Get mean color in BGR
    mean = cv2.mean(roi)[:3]  # [B, G, R]
    return {
        "avg_color_bgr": [round(c, 2) for c in mean]
    }

def extract_text_from_roi(roi):
    # Convert ROI to RGB for Tesseract
    roi_rgb = cv2.cvtColor(roi, cv2.COLOR_BGR2RGB)
    text = pytesseract.image_to_string(roi_rgb, config="--psm 6")  # Assume single uniform block of text
    return text.strip()

# Extend labeled boxes with fingerprint and text
for i, box in enumerate(final_boxes):
    labeled_box = box.copy()
    x, y, w, h = box["x"], box["y"], box["width"], box["height"]
    
    roi = image[y:y+h, x:x+w]
    
    # Add label
    labeled_box["label"] = f"UI{i+1}"
    
    # Add color fingerprint
    labeled_box["color_fingerprint"] = get_color_fingerprint(roi)

    # Try OCR
    try:
        labeled_box["text"] = extract_text_from_roi(roi)
    except Exception as e:
        labeled_box["text"] = ""

    labeled_boxes.append(labeled_box)

print(json.dumps(labeled_boxes))


# Draw boxes on the image with different colors for different methods
colors = [(0, 255, 0), (255, 0, 0), (0, 0, 255), (255, 255, 0), (255, 0, 255)]
for i, box in enumerate(final_boxes):
    color = colors[i % len(colors)]
    cv2.rectangle(
        image,
        (box["x"], box["y"]),
        (box["x"] + box["width"], box["y"] + box["height"]),
        color,
        2
    )
    # Add label
    cv2.putText(image, f"UI{i+1}", (box["x"], box["y"]-10), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

# Save annotated image
output_path = image_path.replace('.png', '_annotated.png')
cv2.imwrite(output_path, image)