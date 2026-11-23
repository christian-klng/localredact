'use client'

import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslations } from 'next-intl'
import type { ExportReport, Problem } from '@/lib/pdf-export'

interface ExportReportDialogProps {
  report: ExportReport | null
  onDownload: () => void
  onCancel: () => void
}

// Shown after the redacted file has been written and checked, before it is
// handed out. A file that failed the check can still be saved, but only as a
// deliberate choice.
export function ExportReportDialog({ report, onDownload, onCancel }: ExportReportDialogProps) {
  const t = useTranslations('ExportReport')
  if (!report) return null

  const { removed } = report
  const removedLines = [
    removed.documentProperties.length ? t('removedProperties', { count: removed.documentProperties.length }) : null,
    removed.xmpMetadata ? t('removedXmp') : null,
    removed.attachments ? t('removedAttachments', { count: removed.attachments }) : null,
    removed.bookmarks ? t('removedBookmarks', { count: removed.bookmarks }) : null,
    removed.links ? t('removedLinks', { count: removed.links }) : null,
    removed.comments ? t('removedComments', { count: removed.comments }) : null,
    removed.formFields ? t('removedFormFields', { count: removed.formFields }) : null,
    removed.scripts ? t('removedScripts', { count: removed.scripts }) : null,
    removed.thumbnails ? t('removedThumbnails', { count: removed.thumbnails }) : null,
    removed.structureTree ? t('removedStructure') : null,
    removed.privateData ? t('removedPrivateData') : null,
  ].filter((line): line is string => !!line)

  const describe = (problem: Problem) => {
    const page = problem.pageIndex === undefined ? '' : ` (${t('page', { page: problem.pageIndex + 1 })})`
    const detail = problem.detail ? `: „${problem.detail}“` : ''
    return `${t(`problem.${problem.kind}`)}${detail}${page}`
  }

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            {report.ok
              ? <CheckCircle2 className='h-5 w-5 text-green-600 shrink-0' />
              : <XCircle className='h-5 w-5 text-destructive shrink-0' />}
            {report.ok ? t('titlePassed') : t('titleFailed')}
          </DialogTitle>
          <DialogDescription>{t('summary', { count: report.redactedAreas })}</DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4 text-sm max-h-[50vh] overflow-y-auto'>
          {!report.ok && (
            <div className='rounded-md border border-destructive/40 bg-destructive/5 p-3'>
              <p className='font-medium text-destructive mb-1.5'>{t('problemsTitle')}</p>
              <ul className='list-disc pl-5 space-y-1 text-foreground'>
                {report.problems.map((problem, i) => <li key={i}>{describe(problem)}</li>)}
              </ul>
            </div>
          )}

          {report.remainingMentions.length > 0 && (
            <div className='rounded-md border border-amber-500/40 bg-amber-500/5 p-3'>
              <p className='font-medium flex items-center gap-1.5 mb-1.5'>
                <AlertTriangle className='h-4 w-4 text-amber-600 shrink-0' /> {t('mentionsTitle')}
              </p>
              <p className='text-muted-foreground mb-1.5'>{t('mentionsHint')}</p>
              <ul className='list-disc pl-5 space-y-1'>
                {report.remainingMentions.map(mention => (
                  <li key={mention.text}>
                    „{mention.text}“ — {t('pages', { pages: mention.pageIndexes.map(i => i + 1).join(', ') })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {removedLines.length > 0 && (
            <div>
              <p className='font-medium flex items-center gap-1.5 mb-1.5'>
                <Info className='h-4 w-4 text-muted-foreground shrink-0' /> {t('removedTitle')}
              </p>
              <ul className='list-disc pl-5 space-y-1 text-muted-foreground'>
                {removedLines.map(line => <li key={line}>{line}</li>)}
              </ul>
            </div>
          )}

          <p className='text-xs text-muted-foreground leading-relaxed'>{t('limits')}</p>
        </div>

        <div className='flex flex-col gap-2 pt-1'>
          <Button variant='outline' onClick={onCancel}>{t('back')}</Button>
          <Button variant={report.ok ? 'default' : 'destructive'} onClick={onDownload}>
            {report.ok ? t('download') : t('downloadAnyway')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
