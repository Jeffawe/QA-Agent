import { pipeline } from '@xenova/transformers';
import { ExtractorOptions, MiniAgentConfig } from "./types.js";

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


export const getAgents = async (goal: string, detailed: boolean = false): Promise<AgentConfigWithDescription[]> => {
    const options: ExtractorOptions = { pooling: 'mean', normalize: true };
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

    const allConfigs = getAllConfigs(detailed);

    // Get goal embedding
    const goalVec = await extractor(goal, options);
    const goalArray = Array.from(goalVec.data);

    const matches: ConfigMatch[] = [];

    // Compare against each config group
    for (const configGroup of allConfigs) {
        // Combine all descriptions in the config group
        const combinedDescription = configGroup.configs
            .map(c => c.description)
            .join(' ') + ' ' + configGroup.description;

        // Get embedding for combined description
        const descVec = await extractor(combinedDescription, options);
        const descArray = Array.from(descVec.data);

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

// Alternative: Hybrid approach with multiple similarity methods
export const getAgentsHybrid = async (goal: string, detailed: boolean = false): Promise<AgentConfigWithDescription[]> => {
    const options: ExtractorOptions = { pooling: 'mean', normalize: true };
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

    const goalVec = await extractor(goal, options);
    const goalArray = Array.from(goalVec.data);

    const allConfigs = getAllConfigs(detailed);

    const matches: (ConfigMatch & {
        semanticSim: number;
        keywordSim: number;
        combinedScore: number
    })[] = [];

    for (const configGroup of allConfigs) {
        const combinedDescription = configGroup.configs
            .map(c => c.description)
            .join(' ') + ' ' + configGroup.description;

        const descVec = await extractor(combinedDescription, options);
        const descArray = Array.from(descVec.data);

        // Semantic similarity
        const semanticSim = normalizedCosineSimilarity(goalArray, descArray);

        // Keyword similarity (Jaccard-like)
        const goalWords = new Set(goal.toLowerCase().split(/\s+/));
        const allKeywords = new Set(
            configGroup.configs.flatMap(c => c.keywords.map(k => k.toLowerCase()))
        );

        const intersection = new Set([...goalWords].filter(word => allKeywords.has(word)));
        const union = new Set([...goalWords, ...allKeywords]);
        const keywordSim = intersection.size / union.size;

        // Combine scores (weighted)
        const combinedScore = (semanticSim * 0.7) + (keywordSim * 0.3);

        const matchedKeywords = [...intersection];

        matches.push({
            config: configGroup.configs,
            similarity: combinedScore,
            semanticSim,
            keywordSim,
            combinedScore,
            matchedKeywords
        });
    }

    matches.sort((a, b) => b.combinedScore - a.combinedScore);
    const bestMatch = matches[0];

    console.log(`Hybrid match: ${bestMatch.config[0].name} group`);
    console.log(`Semantic: ${bestMatch.semanticSim.toFixed(3)}, Keyword: ${bestMatch.keywordSim.toFixed(3)}, Combined: ${bestMatch.combinedScore.toFixed(3)}`);

    return bestMatch.config;
};