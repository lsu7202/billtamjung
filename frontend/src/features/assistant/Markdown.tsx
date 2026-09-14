/** 모델 글을 그린다 — 마크다운. 정본 10-AI-어시스턴트 §1 채팅 「마크다운 렌더 (표·목록·코드)」
 *
 *  모델은 목록을 표로 쓴다. 날것으로 두면 `| 주소 | 면적 |` 이 그대로 보였다(2026-09-08 실측).
 *  react-markdown + remark-gfm(표). 링크는 새 탭, 표는 제 그릇 안에서만 가로로 밀린다 —
 *  화면 전체가 옆으로 스크롤되면 안 된다. */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** 물결을 취소선으로 읽지 않게 막는다.
 *
 *  gfm 은 `~a~` 를 취소선으로 본다. 그런데 우리 글에서 물결은 **범위**다 —
 *  「2014~2015년」·「130~170m」·「100억~200억」. 그래서 「준공은 2014~2015년대 신축이고
 *  종각이 근처(130~170m)」가 화면에서 「준공은 20142015년대 신축이고 종각이 근처(130170m)」로
 *  나왔다(2026-09-09 대표). **가운데가 통째로 지워졌다.**
 *  취소선은 우리 답에 쓸 일이 없으니 물결만 살린다. */
const keepTilde = (t: string) => t.replace(/~(?=\d)|(?<=\d)~/g, "\\~");

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({ children }) => <div className="md-tw"><table>{children}</table></div>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
      }}
    >
      {keepTilde(text)}
    </ReactMarkdown>
  );
}
