import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useI18n } from '../hooks/useLocale';

interface QrProps {
  readonly value: string;
  readonly size?: number;
}

/**
 * Render `value` as a QR code data-URL image. Dark modules on a light quiet
 * zone stay scannable in both themes, matching the mockup's payment QR.
 */
export function Qr({ value, size = 168 }: QrProps) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      margin: 1,
      width: size,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b0f16', light: '#e9f2fb' },
    })
      .then((url) => {
        if (active) {
          setSrc(url);
        }
      })
      .catch(() => {
        if (active) {
          setSrc(null);
        }
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  return (
    <div className="qr" style={{ width: size, height: size }} aria-label={t('common_qr_alt')}>
      {src ? <img src={src} width={size} height={size} alt={t('common_qr_alt')} /> : null}
    </div>
  );
}
