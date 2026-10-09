import { diffLines } from 'diff'
export interface DiffRow { kind: 'same' | 'add' | 'remove'; text: string; before?: number; after?: number }
export function codeDiff(before: string, after: string): DiffRow[] {
  let oldLine=1,newLine=1
  const rows: DiffRow[]=[]
  for(const part of diffLines(before,after)){
    const lines=part.value.split('\n');if(lines.at(-1)==='')lines.pop()
    for(const text of lines)rows.push({kind:part.added?'add':part.removed?'remove':'same',text,...(!part.added?{before:oldLine++}:{}),...(!part.removed?{after:newLine++}:{})})
  }
  return rows
}
