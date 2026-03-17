import type { Message } from "@/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface ChatBubbleProps {
  message: Message;
}

export function ChatBubble({ message }: ChatBubbleProps): JSX.Element {
  const isUser = message.role === "user";
  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed overflow-x-auto",
          isUser
            ? "bg-foreground text-background whitespace-pre-wrap"
            : "border border-border bg-background text-foreground prose prose-sm dark:prose-invert"
        ].join(" ")}
      >
        {isUser ? (
          message.content
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { strict: false }]]}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
