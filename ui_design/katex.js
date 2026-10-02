// 1. Import the auto-render extension from node_modules
import renderMathInElement from 'katex/dist/contrib/auto-render.mjs';

// 2. Import the styling so your math layouts don't break
import 'katex/dist/katex.min.css';

// 3. Execute the function once the DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
    renderMathInElement(document.body, {
        delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
        ],
        throwOnError: false
    });
});