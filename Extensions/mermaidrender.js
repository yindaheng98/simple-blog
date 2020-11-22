function render(text) {
    if (text[0] !== "#")
        text = "#" + text;
    let texts = text.split(/\n```mermaid\n|\n```mermaid\r\n/g);
    for (let i = 1; i < texts.length; i++) {
        let ts = texts[i].split(/\n```\n|\n```\r\n|\n```/g);
        texts[i] = ts[0] + '</div>\n' + ts.splice(1).join('\n');
    }
    text = texts.join('<div class="mermaid">\n');
    return text;
}

module.exports = render;