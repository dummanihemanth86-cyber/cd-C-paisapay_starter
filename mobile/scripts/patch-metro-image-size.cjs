const fs = require('node:fs');
const path = require('node:path');

const metroAssetsPath = path.join(__dirname, '..', 'node_modules', 'metro', 'src', 'Assets.js');
const expected = '  const { width, height } = (0, _imageSize.default)(content);';
const compatible = [
  '  const { width, height } = getImageSize(content);',
].join('\n');
const previousCompatible = [
  '  const imageSize = _imageSize.default;',
  '  const { width, height } =',
  '    typeof imageSize === "function"',
  '      ? (0, imageSize)(content)',
  '      : imageSize.imageSize(content);',
].join('\n');
const helper = [
  'function getImageSize(input) {',
  '  const imageSize = _imageSize.default;',
  '  const image =',
  '    typeof input === "string" ? _fs.default.readFileSync(input) : input;',
  '  if (typeof imageSize === "function") {',
  '    return imageSize(image);',
  '  }',
  '  return imageSize.imageSize(image);',
  '}',
].join('\n');

if (!fs.existsSync(metroAssetsPath)) {
  throw new Error('Expected Metro Assets.js was not installed.');
}

let source = fs.readFileSync(metroAssetsPath, 'utf8');
if (source.includes(compatible) && source.includes('const dimensions = isImage ? getImageSize(isImageInput) : null;') && source.split(helper).length === 2 && source.split('function getImageSize(input) {').length === 2) {
  process.exit(0);
}
if (!source.includes(expected) && !source.includes(previousCompatible) && !source.includes(compatible)) {
  throw new Error('Metro Assets.js changed; review image-size compatibility before building.');
}

const priorHelper = source.indexOf('function getImageSize(input) {');
const pathImport = source.indexOf('var _path = _interopRequireDefault(require("path"));');
if (priorHelper >= 0 && pathImport > priorHelper) {
  source = source.slice(0, priorHelper) + source.slice(pathImport);
}
source = source.replace(expected, compatible).replace(previousCompatible, compatible);
source = source.replace(
  'var _imageSize = _interopRequireDefault(require("image-size"));',
  `var _imageSize = _interopRequireDefault(require("image-size"));\n${helper}`,
);
source = source.replace(
  'const dimensions = isImage ? (0, _imageSize.default)(isImageInput) : null;',
  'const dimensions = isImage ? getImageSize(isImageInput) : null;',
);
const firstHelper = source.indexOf('function getImageSize(input) {');
const secondHelper = source.indexOf('function getImageSize(input) {', firstHelper + 1);
if (secondHelper >= 0) {
  const followingImport = source.indexOf('var _path = _interopRequireDefault(require("path"));', secondHelper);
  if (followingImport < 0) {
    throw new Error('Could not normalize duplicate Metro image-size helpers.');
  }
  source = source.slice(0, secondHelper) + source.slice(followingImport);
}
fs.writeFileSync(metroAssetsPath, source);
