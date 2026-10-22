// Builds preview.html from template.html + the theme block in Shared/_ModernTheme.cshtml,
// so the preview always shows the real theme. Usage: node build.js <viewsDir>
'use strict';
const fs = require('fs');
const path = require('path');

const theme = fs.readFileSync(path.join(process.argv[2], 'Shared', '_ModernTheme.cshtml'), 'utf8');
const css = theme.match(/<style>[\s\S]*?<\/style>/)[0].replace(/@@/g, '@');
const tpl = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
fs.writeFileSync(path.join(__dirname, 'preview.html'), tpl.replace('<!--THEME-->', css));
console.log('preview.html written');
