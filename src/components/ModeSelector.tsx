'use client'

import { Shield } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from 'next-intl'
import { localAi } from '@/lib/config'

// There is only one mode - everything runs locally - so this is a badge that
// says so, with a tooltip explaining what "local" means in this build.
export function ModeSelector() {
  const t = useTranslations('ModeSelector')

  const localDesc = localAi === 'ner-browser' ? t('localBrowserDesc')
    : localAi === 'llm' ? t('localLlmDesc')
    : t('localSpacyDesc')

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className='flex items-center gap-1.5 px-2 text-xs text-muted-foreground'>
          <Shield className='h-3.5 w-3.5 text-green-600' />
          <span className='font-medium text-foreground'>{t('localLabel')}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side='bottom' className='max-w-52 text-center'>{localDesc}</TooltipContent>
    </Tooltip>
  )
}
