"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const context = {window: {}};
vm.runInNewContext(fs.readFileSync("frontend/assets/js/components/report-calculator.js", "utf8"), context);
const calculate = context.window.ReportCalculator.evaluate;
for (const [expression, expected] of [["634.23×65",41224.95],["2+3*4",14],["(2+3)*4",20],["-5×-2",10],["0.1+0.2",0.3],["200+10%",220],["200-10%",180],["200×10%",20],["50÷2",25],["-(12+3)",-15],["1e+10+2",10000000002]]) assert.equal(calculate(expression),expected,expression);
for (const expression of ["1/0","1+","(2+3","alert(1)","2**3","NaN","Infinity","1;2", "", "(".repeat(150)]) assert.throws(()=>calculate(expression),undefined,expression);
console.log("PASS: scratch calculator arithmetic, percentage behaviour and invalid-expression handling");
for (const [expression, expected] of [
  ["2^3^2",512],["-2^2",-4],["(-2)^2",4],["2^-2",.25],
  ["sqrt(81)",9],["cbrt(-27)",-3],["root(81,4)",3],["root(-8,3)",-2],
  ["5!",120],["0!",1],["log10(1000)",3],["log2(32)",5],["log(81,3)",4],
  ["ln(e)",1],["exp(0)",1],["pow10(3)",1000],["pow2(4)",16],["reciprocal(4)",.25],
  ["sin(30)",.5],["cos(90)",0],["tan(45)",1],["asin(.5)",30],["acos(.5)",60],["atan(1)",45],
  ["sinh(0)",0],["cosh(0)",1],["tanh(0)",0],["asinh(0)",0],["acosh(1)",0],["atanh(0)",0],
  ["3.5e-3*1000",3.5],["2*pi",Math.PI*2],["2+sin(30)*10",7],
]) assert.ok(Math.abs(calculate(expression)-expected) <= Math.max(1e-12,Math.abs(expected)*1e-12),expression);
assert.equal(calculate("sin(pi/2)",{angleMode:"rad"}),1);
assert.ok(Math.abs(calculate("asin(1)",{angleMode:"rad"})-Math.PI/2)<1e-12);
for(const expression of ["sqrt(-1)","ln(0)","ln(-1)","log(10,1)","root(8,0)","root(-8,2)","asin(2)","acosh(0)","atanh(1)","tan(90)","(-1)!","2.5!","171!","reciprocal(0)","sin()","sin(1,2)","root(9)","constructor(1)","Math.sin(1)","pow10(9999)"]){assert.throws(()=>calculate(expression),undefined,expression);}
console.log("PASS: scientific arithmetic, DEG/RAD, secondary functions, roots, memory-value expressions and domain errors");
