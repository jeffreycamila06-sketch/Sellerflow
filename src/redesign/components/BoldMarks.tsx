// "**bold**" inside a translated sentence → <b>bold</b> (the words around it stay in the sentence's own order).
export default function BoldMarks({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b> : part))}</>;
}
