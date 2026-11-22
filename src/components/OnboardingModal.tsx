'use client'

import { useState } from 'react'
import { Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useTranslations } from 'next-intl'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'
import { localAi } from '@/lib/config'

interface OnboardingModalProps {
  open: boolean
  onAccept: () => void
}

export function OnboardingModal({ open, onAccept }: OnboardingModalProps) {
  const t = useTranslations('Onboarding')
  const tMode = useTranslations('ModeSelector')
  const localDesc = localAi === 'ner-browser' ? tMode('localBrowserDesc')
    : localAi === 'llm' ? tMode('localLlmDesc')
    : tMode('localSpacyDesc')
  const [checked, setChecked] = useState(false)
  return (
    <Dialog open={open}>
      <DialogContent className='sm:max-w-xl' showCloseButton={false} onInteractOutside={e => e.preventDefault()}>
        <DialogHeader>
          <div className='flex items-center justify-between'>
            <DialogTitle>{t('title')}</DialogTitle>
            <LocaleSwitcher />
          </div>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4 text-sm'>
          <p className='text-muted-foreground leading-relaxed'>
            <span className='font-medium text-foreground'>{t('reviewTitle')} </span>
            {t('reviewDesc')}
          </p>

          <div className='flex items-start gap-2.5 p-2.5 rounded-md border border-border bg-muted/50'>
            <Shield className='h-4 w-4 text-green-600 shrink-0 mt-0.5' />
            <div>
              <p className='font-medium text-foreground'>{t('localLabel')}</p>
              <p className='text-muted-foreground text-xs mt-0.5 leading-relaxed'>{localDesc}</p>
            </div>
          </div>
        </div>

        <label className='flex items-start gap-3 cursor-pointer select-none mt-1 group'>
          <input type='checkbox' checked={checked} onChange={e => setChecked(e.target.checked)}
            className='mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer shrink-0' />
          <span className='text-sm leading-relaxed text-muted-foreground group-hover:text-foreground transition-colors'>
            {t('acknowledgement')}
          </span>
        </label>

        <Button onClick={onAccept} disabled={!checked} className='w-full'>
          {t('proceed')}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
