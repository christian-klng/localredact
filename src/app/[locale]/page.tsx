import { redirect } from '@/lib/navigation'
import { getLocale } from 'next-intl/server'

// The app is the only page.
export default async function RootPage() {
  redirect({ href: '/app', locale: await getLocale() })
}
