export function normalize(value) {
  const lines = value.split(/\r\n|\n|\r/);
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\t/g, " ");
    if (i) line = line.replace(/^ +/, "");
    if (i < lines.length - 1) line = line.replace(/ +$/, "");
    if (line) {
      out += line;
      if (i < lines.length - 1 && lines.slice(i + 1).some((x) => x.trim()))
        out += " ";
    }
  }
  return out;
}
export default function ({ types: t }) {
  return {
    name: "meet-ui-text",
    visitor: {
      Program: {
        enter(p, s) {
          s.active =
            /[\\/]src[\\/].*\.[jt]sx?$/.test(s.filename || "") &&
            !/ui-language/.test(s.filename || "");
          s.used = false;
          s.fn = p.scope.generateUidIdentifier("meetUIText");
        },
        exit(p, s) {
          if (s.used)
            p.unshiftContainer(
              "body",
              t.importDeclaration(
                [t.importSpecifier(s.fn, t.identifier("uiText"))],
                t.stringLiteral("./ui-language"),
              ),
            );
        },
      },
      CallExpression: {
        exit(p, s) {
          if (!s.active || !p.node.arguments.length) return;
          const c = p.node.callee;
          if (
            (t.isMemberExpression(c) &&
              t.isIdentifier(c.object, { name: "window" }) &&
              t.isIdentifier(c.property) &&
              ["confirm", "prompt", "alert"].includes(c.property.name)) ||
            (t.isIdentifier(c) &&
              ["confirm", "prompt", "alert"].includes(c.name))
          ) {
            s.used = true;
            p.node.arguments[0] = t.callExpression(t.cloneNode(s.fn), [
              p.node.arguments[0],
            ]);
          }
        },
      },
      JSXText(p, s) {
        if (!s.active) return;
        const v = normalize(p.node.value);
        if (!/\p{L}/u.test(v)) return;
        s.used = true;
        p.replaceWith(
          t.jsxExpressionContainer(
            t.callExpression(t.cloneNode(s.fn), [t.stringLiteral(v)]),
          ),
        );
        p.skip();
      },
      JSXExpressionContainer: {
        exit(p, s) {
          if (!s.active || t.isJSXEmptyExpression(p.node.expression)) return;
          const a = p.parentPath;
          if (
            a.isJSXAttribute() &&
            !["placeholder", "title", "alt", "aria-label"].includes(
              a.node.name.name,
            )
          )
            return;
          if (!a.isJSXAttribute() && !a.isJSXElement() && !a.isJSXFragment())
            return;
          if (
            t.isCallExpression(p.node.expression) &&
            t.isIdentifier(p.node.expression.callee, { name: s.fn.name })
          )
            return;
          s.used = true;
          p.node.expression = t.callExpression(t.cloneNode(s.fn), [
            p.node.expression,
          ]);
        },
      },
      JSXAttribute(p, s) {
        if (
          !s.active ||
          !["placeholder", "title", "alt", "aria-label"].includes(
            p.node.name.name,
          ) ||
          !t.isStringLiteral(p.node.value)
        )
          return;
        s.used = true;
        p.node.value = t.jsxExpressionContainer(
          t.callExpression(t.cloneNode(s.fn), [
            t.stringLiteral(p.node.value.value),
          ]),
        );
        p.skip();
      },
    },
  };
}
