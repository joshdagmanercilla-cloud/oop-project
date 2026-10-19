(() => {
  const mount = document.getElementById('guest-menu-qr');
  const download = document.getElementById('download-menu-qr');
  const error = document.getElementById('qr-error');
  if (!mount || !download) return;

  const showError = message => {
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  };

  if (typeof window.QRCode !== 'function') {
    showError('QR generation needs an internet connection. Reload when online.');
    return;
  }

  try {
    const menuUrl = new URL(window.location.href);
    menuUrl.hash = 'menu';
    menuUrl.search = '';
    new window.QRCode(mount, {
      text: menuUrl.href,
      width: 176,
      height: 176,
      colorDark: '#17382f',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.H,
    });

    const canvas = mount.querySelector('canvas');
    const image = mount.querySelector('img');
    const imageUrl = canvas?.toDataURL('image/png') || image?.src;
    if (!imageUrl) throw new Error('The QR image was not created.');
    download.href = imageUrl;
    download.hidden = false;
  } catch {
    showError('The menu QR code could not be generated. Reload and try again.');
  }
})();