import fs from 'fs';
import { LLM } from '../abstract';

export default class VisionModel {
    private modelClient: LLM | null = null;

    loadModel(model: LLM): void {
        try {
            this.modelClient = model;
        } catch (error) {
            console.error('Error loading model:', error);
            throw error;
        }
    }

    async loadImage(imagePath: string): Promise<string> {
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            const base64Image = imageBuffer.toString('base64');
            return base64Image;
        } catch (error) {
            console.error('Error loading image:', error);
            throw error;
        }
    }

    async analyzeImage(imagePath: string, extraInfo: string): Promise<string> {
        const text = `You are the vision system for an AI game-testing agent analyzing a WebGL game screenshot.
            Your task is to provide a detailed scene description using the annotated bounding boxes. Use this structure:

            1. **Environment**: Briefly describe the background and setting.
            2. **Player Character**: Location (e.g., "bottom-left"), appearance, state (health, animation, direction).
            3. **Game Objects**: List enemies, collectibles, platforms, obstacles — include labels, counts, and positions.
            4. **UI Elements**: Describe menus, buttons, health bars, scores, timers — include exact text, values, and their bounding box label (e.g., UI1 = "Play").
            5. **Interactive Elements**: Identify doors, switches, NPCs, or anything the player can interact with — include labels and positions.
            6. **Visual Effects**: Note visible animations, particles, lighting.
            7. **Spatial Layout**: Describe relative positioning of key elements (e.g., "enemy above platform").
            8. **Game State**: Summarize what seems to be happening right now.
            9. **Label Mapping**: For each bounding box label (e.g., UI3), explain what it refers to (e.g., "UI3 = Exit Button").
            10. **Mouse Information**: There should be a blue dot in the image. It represents where the mouse has moved to last. Mention its postion.

            Use directional terms ("top-left", "center", etc.), count objects accurately, and quote visible text exactly.


            Extra context from the game agent: ${extraInfo}
            `;

        try {
            if (!this.modelClient) {
                throw new Error("Model client is not loaded. Please load the model first.");
            }

            if (!fs.existsSync(imagePath)) {
                throw new Error(`Image file not found: ${imagePath}`);
            }
            const base64Image = await this.loadImage(imagePath);

            const response = await this.modelClient.generateImageResponse(text, base64Image);

            return response;
        } catch (error) {
            console.error('Error analyzing image:', error);
            throw error;
        }
    }
}