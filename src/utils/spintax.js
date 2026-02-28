/**
 * Parses and evaluates spintax formatted strings.
 * Supports nested structures like {Oi|{Olá|Eaí}}
 * @param {string} text - The text containing spintax blocks.
 * @returns {string} The randomized string.
 */
function parseSpintax(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }

    // RegEx to find the innermost {a|b|c} blocks
    const spintaxRegex = /\{([^{}]*)\}/g;

    let parsedText = text;
    let matches;

    // Keep replacing the innermost blocks until no curly braces remain
    while ((matches = parsedText.match(spintaxRegex)) !== null) {
        for (const match of matches) {
            // Remove the outer curly braces
            const innerContent = match.slice(1, -1);

            // Split by the pipe character to get the options
            const options = innerContent.split('|');

            // Select a random option
            const selectedOption = options[Math.floor(Math.random() * options.length)];

            // Replace the original {block} with the selected option
            parsedText = parsedText.replace(match, selectedOption);
        }
    }

    return parsedText;
}

module.exports = {
    parseSpintax
};
