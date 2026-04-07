export function levenshtein(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = b[i - 1] === a[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost,
            );
        }
    }

    return matrix[b.length][a.length];
}

export function findCandidates(input: string, candidates: string[], maxResults = 3): string[] {
    if (candidates.length === 0 || input.length === 0) return [];

    const threshold = Math.max(2, Math.floor(input.length * 0.4));
    const inputLower = input.toLowerCase();

    const scored = candidates
        .map(c => ({ name: c, distance: levenshtein(input, c) }))
        .filter(c => c.distance <= threshold || c.name.toLowerCase().startsWith(inputLower))
        .sort((a, b) => a.distance - b.distance);

    return scored.slice(0, maxResults).map(c => c.name);
}
