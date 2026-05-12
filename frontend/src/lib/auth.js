export async function setAccessTokenCookie(token) {
  try {
    const response = await fetch('/api/auth/set-cookie', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });
    
    if (!response.ok) {
      console.error('Failed to set access token cookie');
    }
  } catch (error) {
    console.error('Error setting access token cookie:', error);
  }
}

export function getAccessTokenCookie() {
  // Can only be securely read on the server side via next/headers
  // For client side, we continue relying on api.js in-memory/localStorage
  return null;
}
