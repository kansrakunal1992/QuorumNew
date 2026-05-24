'use client'
import { useRouter } from 'next/navigation'

interface Props {
  label?: string
  className?: string
  style?: React.CSSProperties
}

export default function BackButton({
  label = '← Back to Council',
  className = 'btn-ghost',
  style = { padding: '10px 20px', fontSize: 13 },
}: Props) {
  const router = useRouter()
  return (
    <button onClick={() => router.back()} className={className} style={style}>
      {label}
    </button>
  )
}
