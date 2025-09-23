// generate-embeddings.js
// Run this script once to generate embeddings for your agent configs

import { pipeline } from '@xenova/transformers';

// Your existing configs (copy from your original file)
const goalConfigWithDesc = [
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

const crawlerConfigWithDesc = [
    {
        name: "autoanalyzer",
        sessionType: "stagehand",
        dependent: true,
        description: "Analyze and process extracted content for insights and patterns",
        keywords: ["analyze", "process", "insights", "patterns", "evaluate", "examine", "study"]
    },
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

const testerConfig = {
    name: "tester",
    sessionType: "stagehand",
    dependent: false,
    description: "Test functionality and validate elements automatically",
    keywords: ["test", "validate", "verify", "check", "functionality", "behavior", "automatic"]
};

async function generateEmbeddings() {
    console.log('Loading model...');
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    const options = { pooling: 'mean', normalize: true };
    
    // Define config groups
    const configGroups = [
        { 
            name: "goal", 
            configs: goalConfigWithDesc, 
            description: "Intelligent goal achievement and planning" 
        },
        { 
            name: "crawler", 
            configs: crawlerConfigWithDesc, 
            description: "Comprehensive web crawling and data extraction" 
        }
    ];
    
    const embeddings = {};
    
    for (const group of configGroups) {
        console.log(`Generating embedding for ${group.name}...`);
        
        // Combine all descriptions in the config group
        const combinedDescription = group.configs
            .map(c => c.description)
            .join(' ') + ' ' + group.description;
            
        console.log(`Description: "${combinedDescription}"`);
        
        // Generate embedding
        const embedding = await extractor(combinedDescription, options);
        const embeddingArray = Array.from(embedding.data);
        
        embeddings[group.name] = embeddingArray;
        
        console.log(`✓ Generated embedding for ${group.name} (${embeddingArray.length} dimensions)`);
    }
    
    // Output the embeddings as JavaScript code
    console.log('\n=== COPY THIS TO YOUR CODE ===\n');
    console.log('export const AGENT_EMBEDDINGS = {');
    
    for (const [name, embedding] of Object.entries(embeddings)) {
        console.log(`  ${name}: [`);
        console.log(`    ${embedding.join(', ')}`);
        console.log(`  ],`);
    }
    
    console.log('};');
    
    console.log('\n=== END ===\n');
    
    return embeddings;
}

// Run the script
generateEmbeddings().catch(console.error);