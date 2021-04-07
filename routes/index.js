var express = require('express');
var router = express.Router();
var fs = require('fs');
var mdit = require('markdown-it')({html: true});
var mermaidrender=require('../Extensions/mermaidrender');
mdit.use(require("@neilsustc/markdown-it-katex"));

/* GET home page. */
router.get(/.*\.md$/, function (req, res, next) {
    let md = 'md' + decodeURI(req.originalUrl);
    fs.readFile(md, function (err, data) {
        if (err) {
            console.log(err);
            next(req, res);
        } else {
            let text = mermaidrender(data.toString());
            let html = mdit.render(text);
            let title = /#\s+(.*?)\n/.exec(text)[1];
            if(!title) title = "!no title!";
            let csspath = md.replace(/[^\/]/g, '').slice(1).split('/').join('../');
            res.render('index', {title: title, contents: html, csspath: csspath});
        }
    });
});

function getIndex(path, parent_name) {
    let index = {};
    let files = fs.readdirSync(path);
    for (let i in files) {
        let filepath = path + '/' + files[i];
        try {
            if (fs.statSync(filepath).isDirectory()) {
                let d = getIndex(path + '/' + files[i], parent_name + files[i] + '/');
                if (JSON.stringify(d) !== '{}') index[files[i]] = d;
            }
            if (files[i].slice(-3) === '.md' && fs.statSync(filepath).isFile()) {
                let text = fs.readFileSync(filepath).toString();
                let title = " " + /#\s+(.*?)\n/.exec(text)[1];
                index[title] = parent_name + files[i];
            }
        } catch (e) {
            console.log(e);
        }
    }
    return index;
}

function parseIndex(index, indent) {
    let s = '';
    if (typeof index === 'string') return s;
    for (let title in index) {
        if (typeof index[title] === 'string')
            s += (indent + '* [' + title + '](' + index[title] + ')\n');
        if (typeof index[title] === typeof {}) {
            s += indent + '* ' + title + '\n';
            s += parseIndex(index[title], indent + '\t');
        }
    }
    return s;
}

/* GET home page. */
router.get('/index', function (req, res, next) {
    let index = getIndex('md', '');
    let text = '# 目录\n' + parseIndex(index, '');
    let html = mdit.render(text);
    res.render('index', {title: '目录', contents: html, csspath: ''});
});

module.exports = router;
