var katex = require('katex');
const { JSDOM } = require("jsdom");
const renderMathInElement = require("./utils");


function render(text) {
    let { document } = (new JSDOM("<!DOCTYPE html><p>" + text + "</p>")).window;
    let el = document.querySelector("p");
    renderMathInElement(document.body, {
        delimiters:
            [{ left: "$", right: "$", display: false },
            { left: "$$", right: "$$", display: true },]
    });
    return el.textContent;
}

module.exports = render;