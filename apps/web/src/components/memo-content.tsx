import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export function MemoContent({
  className,
  content,
}: {
  className?: string;
  content: string;
}) {
  return (
    <div className={cn("memo-markdown text-[15px] leading-7", className)}>
      <Markdown
        components={{
          a({ href, children, ...props }) {
            const external =
              href?.startsWith("http://") || href?.startsWith("https://");
            return (
              <a
                {...props}
                href={href}
                rel={external ? "noreferrer noopener" : undefined}
                target={external ? "_blank" : undefined}
              >
                {children}
              </a>
            );
          },
        }}
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {content}
      </Markdown>
    </div>
  );
}
