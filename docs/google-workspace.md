# Google Workspace plugin

Open **Settings → Plugins → Google Workspace**. Lares uses the pinned gogcli
v0.46.0 release and its matching core, Gmail, Calendar, Drive, Docs, Sheets,
and Slides skills. Installation does not require a Google account or OAuth
configuration. Download installs and enables the plugin; Disable unloads its
skills while retaining the local connection.

## Connect an account

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select
   a project and enable Gmail, Calendar, Drive, Docs, Sheets, and Slides APIs.
2. Configure Google Auth Platform branding and audience. For an External app in
   Testing, add your Google account as a test user.
3. Create an OAuth client with application type **Desktop app** and download its
   client JSON. Web client JSON and service-account JSON are not accepted.
4. Install the plugin and use **Import OAuth JSON**. The client secret is passed
   to gog over stdin and stored in its encrypted file keyring.
5. Enter your Google or Google Workspace email and click **Connect Google**.
6. Open the generated authorization link, choose that account, and approve the
   listed permissions. The return page may show a connection error because the
   CLI is running on Olares rather than your browser's machine. Copy the entire
   localhost URL from the address bar, paste it into **Complete return address**,
   and click **Finish connecting**. Do not share this URL in chat or screenshots.

The flow uses gog's remote authorization with PKCE and mandatory state checking.
A connection attempt expires after five minutes; start a new attempt if it expires,
consent is cancelled, or the browser/page is closed. Reauthorization retains the
same client, email, and six services. Switch accounts or replace client configuration
by disconnecting the existing account first. This version supports one account per
Lares instance and uses no third-party authorization broker.

## Connection and troubleshooting

**Check connection** asks gog to exchange the stored refresh token for an access
token. A successful refresh does not guarantee every Google API is enabled or
that organization policies permit every operation. Missing permissions, disabled
APIs, network failures, and expired/revoked grants must be resolved before the
affected operation can succeed. Approve all listed permissions for the six services.
Google Workspace organizations may require an administrator to approve the OAuth app.

Testing-mode OAuth grants for user-data scopes may expire after seven days.
See [Google's token expiration documentation](https://developers.google.com/identity/protocols/oauth2#expiration)
and the [gog setup guide](https://gogcli.sh/quickstart.html).

**Disconnect** removes the account's stored refresh token from this Lares instance
and cancels pending authorization, while retaining OAuth client configuration and
the installed plugin. It does not revoke Google's application grant; manage that
separately at [Google Account connections](https://myaccount.google.com/connections).

## Runtime storage

- CLI and matching skills: `$LARES_DATA_DIR/skill-packs/google-workspace`.
- Enabled skills: `$LARES_DATA_DIR/skills`.
- gog home, encrypted keyring, and private connection state:
  `$LARES_DATA_DIR/integrations/google-workspace`.
- Stable executable launcher: `$LARES_DATA_DIR/plugin-bin/gog`, prepended to the
  actual Agent process PATH and restored on startup.

The launcher supplies the same isolated gog home, client, selected account, and
keyring password as the settings API. Password/keyring files are private to the
runtime user; back up the complete integration directory together if backing up
Lares. This protects file contents at rest but does not isolate credentials from
processes running as that same OS user. Credentials do not enter skill directories,
images, browser responses, or committed files. Download errors can be retried;
existing installations remain available if a replacement download fails.

## Validation boundary

Installation, encrypted configuration import, and PKCE link generation can be
verified without a real Google account. Completing consent, refresh-token checks,
API access, and an Agent reading Google data require a dedicated test account and
its OAuth client. Mocked tests are not proof of those live account operations.
