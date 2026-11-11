const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canViewFinancialAction, financialActionState } = require('../../../shared/adminFinancialUx.cjs');

test('native admin financial action visibility follows the same role policy', () => {
  for (const role of ['FINANCE', 'ADMIN', 'SUPER_ADMIN']) {
    assert.equal(canViewFinancialAction('paymentVerification', role), true);
    assert.equal(financialActionState('paymentVerification', role, false).enabled, false);
    assert.match(financialActionState('paymentVerification', role, false, null).reason, /has not confirmed manual UPI review availability/i);
    assert.match(financialActionState('paymentVerification', role, false, false).reason, /manual UPI safety gate is disabled/i);
    assert.equal(financialActionState('paymentVerification', role, false, true).enabled, true);
  }
  assert.equal(canViewFinancialAction('paymentVerification', 'OPERATIONS'), false);
  assert.equal(canViewFinancialAction('quickDeposit', 'OPERATIONS'), true);
  assert.equal(financialActionState('quickDeposit', 'ADMIN', false, true).enabled, false);
});

test('unavailable payout, withdrawal verification and wallet mutation stay non-actionable', () => {
  for (const action of ['withdrawalVerification', 'payoutProcessing', 'walletAdjustment']) {
    assert.equal(financialActionState(action, 'FINANCE', true).enabled, false);
  }
});

test('Admin snapshot panels do not label fetched data as live', () => {
  const nativeAdmin = fs.readFileSync(path.resolve(__dirname, '../App.js'), 'utf8');
  const browserAdmin = fs.readFileSync(path.resolve(__dirname, '../../../admin/src/main.jsx'), 'utf8');

  assert.doesNotMatch(nativeAdmin, /LIVE\s*[·]|LIVE BACKEND CHECK/);
  assert.doesNotMatch(browserAdmin, /Live PaisaPay data|Loading live dashboard|LIVE RECORD/);
});

test('native Admin JSX has no literal space children outside Text components', () => {
  const nativeAdmin = fs.readFileSync(path.resolve(__dirname, '../App.js'), 'utf8');
  const { parse } = require('@babel/parser');
  const ast = parse(nativeAdmin, { sourceType: 'unambiguous', plugins: ['jsx'] });
  const unsafeSpaces = [];

  function visit(node, elementStack = []) {
    if (!node || typeof node !== 'object') return;
    const stack = node.type === 'JSXElement'
      ? [...elementStack, node.openingElement.name.name]
      : elementStack;
    if (node.type === 'JSXText' && /^ +$/.test(node.value)
      && !['Text', 'TextInput'].includes(stack.at(-1))) {
      unsafeSpaces.push({ line: node.loc?.start.line, parent: stack.at(-1), value: node.value });
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, stack));
      else if (value && typeof value === 'object') visit(value, stack);
    }
  }

  visit(ast);
  assert.deepEqual(unsafeSpaces, []);
});
