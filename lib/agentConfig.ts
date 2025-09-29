import { pipeline } from '@xenova/transformers';
import { ExtractorOptions, MiniAgentConfig } from "./types.js";
import { AGENT_EMBEDDINGS } from './embeddings/agentembeds.js';

interface AgentConfigWithDescription extends MiniAgentConfig {
    description: string;
    keywords: string[];
}

interface ConfigMatch {
    config: AgentConfigWithDescription[];
    similarity: number;
    matchedKeywords: string[];
}

// Enhanced configs with descriptions and keywords
export const goalConfigWithDesc: AgentConfigWithDescription[] = [
    {
        name: "goalagent",
        sessionType: "stagehand",
        dependent: true,
        description: "Accomplish specific tasks and objectives with intelligent planning",
        keywords: ["goal", "task", "objective", "accomplish", "achieve", "complete", "intelligent", "planning"]
    },
    {
        name: "planneragent",
        sessionType: "stagehand",
        dependent: false,
        agentDependencies: ["goalagent"],
        description: "Create strategic plans and workflows for complex multi-step processes",
        keywords: ["plan", "strategy", "workflow", "steps", "process", "organize", "structure"]
    }
];

export const crawlerConfigWithDesc: AgentConfigWithDescription[] = [
    {
        name: "autoanalyzer",
        sessionType: "stagehand",
        dependent: true,
        description: "Analyze and process extracted content for insights and patterns",
        keywords: ["analyze", "process", "insights", "patterns", "evaluate", "examine", "study"]
    },
    // {
    //     name: "tester",
    //     sessionType: "stagehand",
    //     dependent: true,
    //     description: "Test functionality and validate system behavior automatically",
    //     keywords: ["test", "validate", "verify", "check", "functionality", "behavior", "automatic"]
    // },
    {
        name: "manualAutoanalyzer",
        sessionType: "stagehand",
        actionServiceType: "manual",
        dependent: true,
        agentDependencies: [],
        description: "Perform manual testing and detailed analysis of specific components",
        keywords: ["manual", "test", "detailed", "analysis", "specific", "components", "examine"]
    },
    {
        name: "autocrawler",
        sessionType: "stagehand",
        dependent: false,
        agentDependencies: ["manualAutoanalyzer", "autoanalyzer"],
        description: "Crawl and navigate through entire websites to extract comprehensive data",
        keywords: ["crawl", "scrape", "navigate", "website", "data", "extract", "comprehensive", "entire", "all pages"]
    }
];

// Tester configuration that gets added when detailed is true
const testerConfig: AgentConfigWithDescription = {
    name: "tester",
    sessionType: "stagehand",
    dependent: false,
    description: "Test functionality and validate elements automatically",
    keywords: ["test", "validate", "verify", "check", "functionality", "behavior", "automatic"]
};

const endPointConfig: AgentConfigWithDescription = {
    name: "endpointagent",
    sessionType: "playwright",
    dependent: false,
    description: "Test functionality and validate API endpoints",
    keywords: ["API", "endpoint", "test", "validate", "functionality", "response", "check"]
};

// Function to get crawler config based on detailed flag
const getCrawlerConfig = (detailed: boolean): AgentConfigWithDescription[] => {
    if (detailed) {
        return [...crawlerConfigWithDesc, testerConfig];
    }
    return crawlerConfigWithDesc;
};

// All available configurations
const getAllConfigs = (detailed: boolean) => [
    { name: "goal", configs: goalConfigWithDesc, description: "Intelligent goal achievement and planning" },
    { name: "crawler", configs: getCrawlerConfig(detailed), description: "Comprehensive web crawling and data extraction" }
];

// Cache for the pipeline (since it's still expensive to load)
let cachedExtractor: any = null;
let modelLoadingPromise: Promise<any> | null = null;

export const initializeModel = async (): Promise<any> => {
    if (cachedExtractor) {
        return cachedExtractor;
    }

    if (modelLoadingPromise) {
        // Model is already being loaded, wait for it
        return await modelLoadingPromise;
    }

    // Start loading the model
    console.log('🧠 Loading AI model for agent selection...');
    modelLoadingPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

    try {
        cachedExtractor = await modelLoadingPromise;
        console.log('✅ AI model loaded successfully');
        return cachedExtractor;
    } catch (error) {
        console.error('❌ Failed to load AI model:', error);
        modelLoadingPromise = null; // Reset so we can try again later
        throw error;
    }
}

export const getEndpointConfig = (): AgentConfigWithDescription[] => {
    return [endPointConfig];
}

export const getAgentsSlow = async (goal: string, detailed: boolean = false): Promise<AgentConfigWithDescription[]> => {
    const options: ExtractorOptions = { pooling: 'mean', normalize: true };
    const extractor = await initializeModel();

    const allConfigs = getAllConfigs(detailed);

    // Get goal embedding
    const goalVec = await extractor(goal, options);
    const goalArray: number[] = Array.from(goalVec.data);

    const matches: ConfigMatch[] = [];

    // Compare against each config group
    for (const configGroup of allConfigs) {
        // Combine all descriptions in the config group
        const combinedDescription = configGroup.configs
            .map(c => c.description)
            .join(' ') + ' ' + configGroup.description;

        // Get embedding for combined description
        const descVec = await extractor(combinedDescription, options);
        const descArray: number[] = Array.from(descVec.data);

        // Calculate normalized cosine similarity
        const similarity = normalizedCosineSimilarity(goalArray, descArray);

        // Calculate keyword matches
        const goalLower = goal.toLowerCase();
        const allKeywords = configGroup.configs.flatMap(c => c.keywords);
        const matchedKeywords = allKeywords.filter(keyword =>
            goalLower.includes(keyword.toLowerCase())
        );

        // Combine similarity and keyword matching (weighted)
        const keywordBonus = Math.min(matchedKeywords.length * 0.1, 0.3); // Max 30% bonus
        const finalScore = similarity + keywordBonus;

        matches.push({
            config: configGroup.configs,
            similarity: finalScore,
            matchedKeywords
        });
    }

    // Sort by similarity and return best match
    matches.sort((a, b) => b.similarity - a.similarity);
    const bestMatch = matches[0];

    console.log(`Best match: ${bestMatch.config[0].name} group (similarity: ${bestMatch.similarity.toFixed(3)})`);
    console.log(`Matched keywords: ${bestMatch.matchedKeywords.join(', ')}`);

    return bestMatch.config;
};

export const getAgentsKeywordOnly = (goal: string, detailed: boolean = false): AgentConfigWithDescription[] => {
    const goalLower = goal.toLowerCase();

    // Use getAllConfigs here too for consistency
    const allConfigs = getAllConfigs(detailed);

    const matches = allConfigs.map(configGroup => {
        const score = configGroup.configs.flatMap(c => c.keywords)
            .reduce((score, keyword) =>
                goalLower.includes(keyword.toLowerCase()) ? score + 1 : score, 0
            );

        return { configGroup, score };
    });

    matches.sort((a, b) => b.score - a.score);

    console.log(`Keyword match: ${matches[0].configGroup.name} (score: ${matches[0].score})`);

    return matches[0].configGroup.configs;
};

export const getAgentsFast = async (goal: string, detailed: boolean = false): Promise<AgentConfigWithDescription[]> => {
    const options: ExtractorOptions = { pooling: 'mean', normalize: true };

    // Load model only once and cache it
    const extractor = await initializeModel();

    if (!extractor) {
        throw new Error("Model not initialized");
    }

    // Generate embedding only for the user's goal
    const goalVec = await extractor(goal, options);
    const goalArray: number[] = Array.from(goalVec.data);

    // Get all config groups using your original function
    const allConfigs = getAllConfigs(detailed);

    const matches = allConfigs.map(configGroup => {
        // Get the pre-computed embedding for this config group
        const configEmbedding = AGENT_EMBEDDINGS[configGroup.name as keyof typeof AGENT_EMBEDDINGS];

        if (!configEmbedding || configEmbedding.length === 0) {
            console.warn(`No embedding found for ${configGroup.name}`);
            return { configGroup, similarity: 0, semanticSim: 0, matchedKeywords: [] };
        }

        // Calculate semantic similarity
        const semanticSim = normalizedCosineSimilarity(goalArray, configEmbedding);

        // Calculate keyword matches (same as before)
        const goalLower = goal.toLowerCase();
        const allKeywords = configGroup.configs.flatMap(c => c.keywords);
        const matchedKeywords = allKeywords.filter(keyword =>
            goalLower.includes(keyword.toLowerCase())
        );

        // Combine similarity and keyword matching
        const keywordBonus = Math.min(matchedKeywords.length * 0.1, 0.3);
        const finalScore = semanticSim + keywordBonus;

        return {
            configGroup,
            similarity: finalScore,
            semanticSim,
            matchedKeywords
        };
    });

    // Sort by similarity and return best match
    matches.sort((a, b) => b.similarity - a.similarity);
    const bestMatch = matches[0];

    console.log(`Fast match: ${bestMatch.configGroup.name} (similarity: ${bestMatch.similarity.toFixed(3)})`);
    console.log(`Semantic: ${bestMatch.semanticSim.toFixed(3)}, Keywords: ${bestMatch.matchedKeywords.join(', ')}`);

    return bestMatch.configGroup.configs;
};

// Enhanced cosine similarity with proper normalization
export const normalizedCosineSimilarity = (vecA: number[], vecB: number[]): number => {
    if (vecA.length !== vecB.length) {
        throw new Error('Vectors must have the same length');
    }

    const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));

    if (magnitudeA === 0 || magnitudeB === 0) {
        return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
};