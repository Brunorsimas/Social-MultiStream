"use strict";

// Compatibility-preserving security backport based on brace-expansion 1.1.16.
// It exposes both the legacy callable API and the v5 named `expand` API while
// enforcing hard input, result-count and accumulated-output limits.

var balanced = require("balanced-match");

var DEFAULT_MAX_RESULTS = 100000;
var DEFAULT_MAX_LENGTH = 4000000;
var DEFAULT_MAX_PATTERN_LENGTH = 4096;

module.exports = expandTop;
module.exports.expand = expandTop;

var escSlash = "\0SLASH" + Math.random() + "\0";
var escOpen = "\0OPEN" + Math.random() + "\0";
var escClose = "\0CLOSE" + Math.random() + "\0";
var escComma = "\0COMMA" + Math.random() + "\0";
var escPeriod = "\0PERIOD" + Math.random() + "\0";

function numeric(str) {
  return parseInt(str, 10) == str ? parseInt(str, 10) : str.charCodeAt(0);
}

function escapeBraces(str) {
  return str
    .split("\\\\").join(escSlash)
    .split("\\{").join(escOpen)
    .split("\\}").join(escClose)
    .split("\\,").join(escComma)
    .split("\\.").join(escPeriod);
}

function unescapeBraces(str) {
  return str
    .split(escSlash).join("\\")
    .split(escOpen).join("{")
    .split(escClose).join("}")
    .split(escComma).join(",")
    .split(escPeriod).join(".");
}

function parseCommaParts(str) {
  if (!str) return [""];

  var parts = [];
  var match = balanced("{", "}", str);
  if (!match) return str.split(",");

  var values = match.pre.split(",");
  values[values.length - 1] += "{" + match.body + "}";
  var postParts = parseCommaParts(match.post);
  if (match.post.length) {
    values[values.length - 1] += postParts.shift();
    values.push.apply(values, postParts);
  }
  parts.push.apply(parts, values);
  return parts;
}

function boundedOption(value, fallback) {
  var parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), fallback);
}

function expandTop(str, options) {
  if (!str) return [];

  options = options || {};
  var max = boundedOption(options.max, DEFAULT_MAX_RESULTS);
  var maxLength = boundedOption(options.maxLength, DEFAULT_MAX_LENGTH);
  var maxPatternLength = boundedOption(
    options.maxPatternLength,
    DEFAULT_MAX_PATTERN_LENGTH,
  );
  if (
    max === 0 ||
    maxLength === 0 ||
    maxPatternLength === 0 ||
    str.length > maxLength ||
    str.length > maxPatternLength
  ) {
    return [];
  }

  if (str.substr(0, 2) === "{}") {
    str = "\\{\\}" + str.substr(2);
  }

  return expand(escapeBraces(str), max, maxLength, true).map(unescapeBraces);
}

function embrace(str) {
  return "{" + str + "}";
}

function isPadded(value) {
  return /^-?0\d/.test(value);
}

function lte(current, end) {
  return current <= end;
}

function gte(current, end) {
  return current >= end;
}

// Fold every top-level brace group into one bounded accumulator. Keeping the
// tail iterative prevents deeply chained patterns from exhausting the stack.
function combine(acc, pre, values, max, maxLength, dropEmpties) {
  var output = [];
  var length = 0;

  for (var accIndex = 0; accIndex < acc.length; accIndex++) {
    for (var valueIndex = 0; valueIndex < values.length; valueIndex++) {
      if (output.length >= max) return output;
      var expansion = acc[accIndex] + pre + values[valueIndex];
      if (dropEmpties && !expansion) continue;
      if (length + expansion.length > maxLength) return output;
      output.push(expansion);
      length += expansion.length;
    }
  }

  return output;
}

function expandSequence(body, isAlphaSequence, max) {
  var values = body.split(/\.\./);
  var output = [];
  var start = numeric(values[0]);
  var end = numeric(values[1]);
  var width = Math.max(values[0].length, values[1].length);
  var increment = values.length === 3
    ? Math.max(Math.abs(numeric(values[2])), 1)
    : 1;
  var test = lte;
  var reverse = end < start;
  if (reverse) {
    increment *= -1;
    test = gte;
  }
  var pad = values.some(isPadded);

  for (
    var current = start;
    test(current, end) && output.length < max;
    current += increment
  ) {
    var item;
    if (isAlphaSequence) {
      item = String.fromCharCode(current);
      if (item === "\\") item = "";
    } else {
      item = String(current);
      if (pad) {
        var needed = width - item.length;
        if (needed > 0) {
          var zeros = new Array(needed + 1).join("0");
          item = current < 0
            ? "-" + zeros + item.slice(1)
            : zeros + item;
        }
      }
    }
    output.push(item);
  }

  return output;
}

function expand(str, max, maxLength, isTop) {
  var acc = [""];
  var dropEmpties = false;
  var firstGroup = true;

  for (;;) {
    var match = balanced("{", "}", str);
    if (!match) {
      return combine(acc, str, [""], max, maxLength, dropEmpties);
    }

    var pre = match.pre;

    if (/\$$/.test(pre)) {
      acc = combine(
        acc,
        pre + "{" + match.body + "}",
        [""],
        max,
        maxLength,
        dropEmpties && !match.post.length,
      );
      firstGroup = false;
      if (!match.post.length) break;
      str = match.post;
      continue;
    }

    var isNumericSequence = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(match.body);
    var isAlphaSequence = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(match.body);
    var isSequence = isNumericSequence || isAlphaSequence;
    var isOptions = match.body.indexOf(",") >= 0;

    if (!isSequence && !isOptions) {
      if (match.post.match(/,(?!,).*\}/)) {
        str = pre + "{" + match.body + escClose + match.post;
        isTop = true;
        continue;
      }
      return combine(
        acc,
        pre + "{" + match.body + "}" + match.post,
        [""],
        max,
        maxLength,
        dropEmpties,
      );
    }

    if (firstGroup) {
      dropEmpties = isTop && !isSequence;
      firstGroup = false;
    }

    var values;
    if (isSequence) {
      values = expandSequence(match.body, isAlphaSequence, max);
    } else {
      var parts = parseCommaParts(match.body);
      if (parts.length === 1) {
        parts = expand(parts[0], max, maxLength, false).map(embrace);
        if (parts.length === 1) {
          acc = combine(
            acc,
            pre + parts[0],
            [""],
            max,
            maxLength,
            dropEmpties && !match.post.length,
          );
          if (!match.post.length) break;
          str = match.post;
          continue;
        }
      }

      values = [];
      var valuesLength = 0;
      for (var partIndex = 0; partIndex < parts.length; partIndex++) {
        var nested = expand(parts[partIndex], max, maxLength, false);
        for (var nestedIndex = 0; nestedIndex < nested.length; nestedIndex++) {
          if (values.length >= max) break;
          if (valuesLength + nested[nestedIndex].length > maxLength) break;
          values.push(nested[nestedIndex]);
          valuesLength += nested[nestedIndex].length;
        }
        if (values.length >= max || valuesLength >= maxLength) break;
      }
    }

    acc = combine(
      acc,
      pre,
      values,
      max,
      maxLength,
      dropEmpties && !match.post.length,
    );
    if (!match.post.length) break;
    str = match.post;
  }

  return acc;
}
