import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface StreamingTextProps {
  text: string;
}

export function StreamingText({ text }: StreamingTextProps): JSX.Element {
  // We append a special unused character to attach the cursor easily,
  // or we render the cursor as a sibling to ReactMarkdown.
  // Rendering it as a sibling is easiest for block-level markdown.
  return (
    <div className="flex w-full justify-start">
      <div className="max-w-[85%] border border-border bg-background px-4 py-3 text-sm leading-relaxed overflow-x-auto prose prose-sm dark:prose-invert">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, { strict: false }]]}
        >
          {text}
        </ReactMarkdown>
        <span className="ml-1 inline-block h-4 w-[1px] animate-pulse bg-foreground align-middle" />
      </div>
    </div>
  );
}
