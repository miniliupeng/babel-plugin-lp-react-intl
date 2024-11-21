import { NodePath, PluginObj } from "@babel/core";
import template from "@babel/template";
import {
  jsxExpressionContainer,
  JSXText,
  StringLiteral,
  TemplateLiteral,
} from "@babel/types";
import generate from "@babel/generator";

const INTL_NAME = "intl";
const DEFINE_MESSAGES = "defineMessages";
const INTL_MESSAGES = "intlMessages";
const INTL_FILE_PATH = "@/locales";
const INTL_DISABLE = "i18n-disable";

function createFormatMessageCall(text: string, expressionParams?: string[]) {
  return template.expression(
    `${INTL_NAME}.formatMessage(${INTL_MESSAGES}["${text.trim()}"]${
      expressionParams
        ? `, {
      ${expressionParams.map((key, index) => `'placeholder${index + 1}': ${key}`).join(",")}
    }`
        : ""
    })`,
    {
      plugins: ["typescript"],
    }
  )();
}

// 判断字符串是否包含中文字符
function isChinese(str) {
  return str && /[\u4e00-\u9fa5]/.test(str); // 匹配中文字符的正则表达式
}

// 标记该文本需要跳过遍历处理
function traverseSkip(path: NodePath) {
  // 跳过带有 i18n-disable 注释的
  if (path.node.leadingComments) {
    path.node.leadingComments = path.node.leadingComments.filter(
      (comment, index) => {
        if (comment.value.includes(INTL_DISABLE)) {
          path.node.skip = true;
          return false;
        }
        return true;
      }
    );
  }
  // 跳过 import语法 和 ts声明
  if (path.findParent((p) => p.isImportDeclaration() || p.isTSLiteralType())) {
    path.node.skip = true;
  }
}

function chineseSkip(path: NodePath, value: string) {
  if (!isChinese(value)) {
    path.node.skip = true;
  }
}

export default function babelPluginLpReactIntl({ messageKeys = [] }: { messageKeys?: string[] } = {}): PluginObj {
  return {
    visitor: {
      Program(path, state) {
        let index = 0; // import语句的行数
        while (path.node.body[index].type === "ImportDeclaration") {
          index++;
        }
        let methodName1 = DEFINE_MESSAGES;
        let methodName2 = INTL_NAME;
        if (path.scope.getBinding(methodName1)) {
          methodName1 = path.scope.generateUid(methodName1);
        }
        if (path.scope.getBinding(methodName2)) {
          methodName2 = path.scope.generateUid(methodName2);
        }

        // 获取所有中文消息
        const fileMessagekeys: string[] = []
        path.traverse({
          "JSXText|StringLiteral"(path) {
            traverseSkip(path);
            const node = path.node as StringLiteral | JSXText;
            chineseSkip(path, node.value);
            if (node.skip) return;
            // console.log("JSXText|StringLiteral", node.value);

            const trimmedValue = node.value.trim();
            if (!fileMessagekeys.includes(trimmedValue))
              fileMessagekeys.push(trimmedValue);
          },
          TemplateLiteral(path) {
            traverseSkip(path);
            const node = path.node as TemplateLiteral;
            if (node.skip) return;
            const value = path.node.quasis
              .map((item) => item.value.raw)
              .reduce((prev, curr, index) => {
                if (index !== path.node.quasis.length - 1) {
                  prev = `${prev}${curr}{placeholder${index + 1}}`;
                }
                return prev;
              }, "");

            chineseSkip(path, value);
            if (node.skip) return;
            // console.log('TemplateLiteral', value);

            const trimmedValue = value.trim();
            if (!fileMessagekeys.includes(trimmedValue))
              fileMessagekeys.push(trimmedValue);
          },
        });
        // console.log(messageKeys);

        if (fileMessagekeys.length > 0) {
          // 添加import
          const ast = template.statements(`
          import { ${methodName1} } from 'react-intl';
          import ${methodName2} from '${INTL_FILE_PATH}';
        `)();
          path.node.body.splice(index, 0, ...ast);
          // 添加 defineMessages
          const messagesAst =
            template.statement(`const ${INTL_MESSAGES} = ${methodName1}({
              ${fileMessagekeys.map((key) => `'${key}': { id: "${key}" }`).join(",")}
            })`)();
          path.node.body.splice(index + 2, 0, messagesAst);
          // 合并到全局的 messageKeys 中
          messageKeys.push(...fileMessagekeys);
        }
      },

      JSXText(path, state) {
        if (state.skip || path.node.skip) return;

        path.replaceWith(
          jsxExpressionContainer(createFormatMessageCall(path.node.value))
        );
        path.skip();
      },

      StringLiteral(path, state) {
        if (state.skip || path.node.skip) return;

        if (path.parent.type === "JSXAttribute") {
          path.replaceWith(
            jsxExpressionContainer(createFormatMessageCall(path.node.value))
          );
        } else {
          // 跳过对象属性中的文本
          if (
            path.findParent(
              (p) =>
                p.isVariableDeclarator() && p.node.id.name === INTL_MESSAGES
            )
          ) {
            return;
          }
          chineseSkip(path, path.node.value);
          if (path.node.skip) return;
          path.replaceWith(createFormatMessageCall(path.node.value));
        }
        path.skip();
      },

      TemplateLiteral(path, state) {
        if (state.skip || path.node.skip) return;
        const expressionParams = path.node.expressions.map(
          (item) => generate.default(item).code
        );
        // console.log(expressionParams);

        const value = path.node.quasis
          .map((item) => item.value.raw)
          .reduce((prev, curr, index) => {
            if (index !== path.node.quasis.length - 1) {
              prev = `${prev}${curr}{placeholder${index + 1}}`;
            }
            return prev;
          }, "");
        path.replaceWith(createFormatMessageCall(value, expressionParams));
        path.skip();
      },
    },
  };
}
