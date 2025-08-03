import { pipeline } from '@xenova/transformers';

const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

// Example: current progress vs. final goal
const goal = 'Book a flight from New York to Paris';
const progress = 'Flight to Paris selected, now filling in passenger info';

const [goalVec, progressVec] = await Promise.all([
  extractor(goal, { pooling: 'mean', normalize: true }),
  extractor(progress, { pooling: 'mean', normalize: true })
]);

// Cosine similarity
function cosineSimilarity(vecA, vecB) {
  return vecA.reduce((acc, v, i) => acc + v * vecB[i], 0);
}

console.log('Similarity:', cosineSimilarity(goalVec.data, progressVec.data));
