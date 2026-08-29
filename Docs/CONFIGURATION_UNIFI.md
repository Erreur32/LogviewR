# UniFi Controller Configuration for viewerlog

> 🇫🇷 [Lire en français](./CONFIGURATION_UNIFI.fr.md)

This guide explains how to configure the UniFi plugin in viewerlog to access your local UniFi controller.

## 📋 Table of contents

1. [Prerequisites](#prerequisites)
2. [Creating a local UniFi user (IMPORTANT)](#creating-a-local-unifi-user-important)
3. [Configuring the plugin in viewerlog](#configuring-the-plugin-in-viewerlog)
4. [Connection test](#connection-test)
5. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you start, make sure you have:

- ✅ A UniFi controller reachable on your local network
- ✅ Administrator rights on the UniFi controller
- ✅ The full controller URL (e.g. `https://192.168.1.100:8443`)
- ✅ The UniFi site name (usually `default`)

---

## Creating a local UniFi user (IMPORTANT)

### ⚠️ Why use a local user?

**We strongly recommend using a LOCAL user account rather than a UniFi cloud account**, for the following reasons:

- ✅ **No 2FA (Two-Factor Authentication)**: Cloud accounts may require two-factor authentication, which blocks API access
- ✅ **More reliable**: Local accounts work directly with the controller's API without depending on cloud services
- ✅ **Better security**: You keep full control over credentials without relying on an external service
- ✅ **Compatibility**: The local API is more stable and better documented

### 📝 Steps to create a local user

1. **Access your UniFi controller**
   - Open your browser and log in to the controller's web interface
   - Typical URL: `https://192.168.1.XXX:8443` or `https://unifi.example.com:8443`

2. **Access the admin settings**
   - Click the **Settings** icon (⚙️) at the bottom left
   - In the left menu, select **Administration**

3. **Create a new user**
   - Click the **Administrators** tab (or **Users** depending on the version)
   - Click the **+ Add Administrator** button

4. **Configure the user**
   - **Username**: Choose a simple name (e.g. `viewerlog`, `api-user`, `dashboard`)
   - **Email**: Optional, but recommended for notifications
   - **Password**: Create a strong, secure password
   - **Role**: Select **Full Admin** (or **Super Admin** depending on the version)
   - **Account type**: ⚠️ **IMPORTANT**: Make sure the type is **Local** (not **Cloud** or **SSO**)
   - **Two-factor authentication**: Disable it for this user (or configure it if needed)

5. **Check the permissions**
   - Make sure the user has the following permissions:
     - ✅ Read devices
     - ✅ Read clients
     - ✅ Read Wi‑Fi networks (WLANs)
     - ✅ Read statistics
   - With the **Full Admin** role, all of these permissions are generally included

6. **Save and test**
   - Click **Add** (or **Save**)
   - Test the connection with these credentials from the controller's web interface to confirm they work

### 🔒 Security best practices

- Use a strong, unique password for this user
- Don't share these credentials with other applications
- Revoke this user if you stop using it
- Consider creating a dedicated user solely for viewerlog (principle of least privilege)

---

## Configuring the plugin in viewerlog

### 1. Access the configuration

1. Log in to viewerlog
2. Click the **Settings** icon (⚙️) in the header
3. In the left menu, select **Administration**
4. Click the **Plugins** tab
5. Find the **UniFi Controller** card in the list
6. Click the **Settings** icon (⚙️) on the UniFi card

### 2. Fill in the configuration form

The configuration modal opens. Fill in the following fields:

#### Connection mode

Select **Local Controller (URL/User/Pass)** to use a local controller.

> 💡 **Note**: **Site Manager API** mode is available for UniFi Cloud users but requires an API key. This guide focuses on Local Controller mode.

#### UniFi Controller URL

- **Format**: `https://IP_OR_DOMAIN:PORT`
- **Examples**:
  - `https://192.168.1.100:8443`
  - `https://unifi.example.com:8443`
  - `https://192.168.1.50:8443`

⚠️ **Important**:
- Always include the protocol (`https://`)
- Always include the port (usually `8443` for HTTPS)
- Use the controller's IP address or full domain name

#### Username

- Enter the username of the local user created earlier
- Example: `viewerlog`, `api-user`, `admin`

#### Password

- Enter the local user's password
- You can click the 👁️ icon to show/hide the password

#### UniFi Site

- **Default value**: `default`
- If you have multiple sites configured in your controller, enter the exact site name
- To find your site name:
  1. Log in to the controller's web interface
  2. The site name is usually shown at the top left of the interface
  3. Or go to **Settings** → **Sites** to see the list of sites

### 3. Test the connection

Before saving, **always test the connection**:

1. Click the **Test connection** button (🔄 icon)
2. Wait a few seconds
3. If the test succeeds:
   - ✅ A green "Connection test successful" message appears
   - You can now save the configuration
4. If the test fails:
   - ❌ A red message with error details appears
   - See the [Troubleshooting](#troubleshooting) section below

### 4. Save the configuration

1. If the connection test succeeded, click **Save**
2. The modal closes automatically
3. The UniFi card in the plugin list should now show **Connected** (green badge)
4. You can now enable the plugin by toggling the **Active** switch

---

## Connection test

### Check the connection status

After configuring the plugin, you can check the connection status:

1. **In the plugin list**:
   - Green **Connected** badge: The plugin is correctly configured and connected
   - Yellow **Not connected** badge: The plugin is enabled but the connection failed
   - Grey **Disabled** badge: The plugin isn't enabled

2. **On the UniFi page**:
   - If the plugin is connected, you can access the UniFi page from the dashboard
   - Device, client, and Wi‑Fi network data should display

### Manually re-test the connection

You can re-test the connection at any time:

1. Go to **Settings** → **Administration** → **Plugins**
2. Click the **🔄 Test** icon on the UniFi card
3. The connection status will be updated

---

## Troubleshooting

### ❌ Error: "Login failed"

**Possible causes:**

1. **Incorrect credentials**
   - ✅ Check the username and password
   - ✅ Test the connection from the controller's web interface with the same credentials

2. **Cloud user instead of local**
   - ✅ Check that the user is of type **Local** in the controller settings
   - ✅ Create a new local user if needed

3. **2FA enabled**
   - ✅ Disable two-factor authentication for this user
   - ✅ Or create a new user without 2FA

4. **Incorrect URL**
   - ✅ Check that the URL includes `https://` and port `:8443`
   - ✅ Test the URL in your browser to confirm it's reachable

### ❌ Error: "Network error" or "Cannot reach the server"

**Possible causes:**

1. **Controller unreachable**
   - ✅ Check that the controller is running and reachable
   - ✅ Test the URL in your browser
   - ✅ Check firewall rules if viewerlog runs in Docker

2. **Network issue**
   - ✅ If viewerlog runs in Docker, check that the container can reach the local network
   - ✅ Check that the controller and viewerlog are on the same network

3. **Self-signed SSL certificate**
   - ✅ If you're using a self-signed certificate, this can cause issues
   - ✅ Consider using a valid certificate or configuring the controller to accept self-signed certificates

### ❌ Error: "Site not found" or "Invalid site"

**Possible causes:**

1. **Incorrect site name**
   - ✅ Check the exact site name in the controller's web interface
   - ✅ The name is case-sensitive
   - ✅ By default, use `default` if unsure

2. **Site deleted**
   - ✅ Check that the site still exists in the controller
   - ✅ Create a new site if needed

### ❌ Error: "Permission denied"

**Possible causes:**

1. **Insufficient permissions**
   - ✅ Check that the user has the **Full Admin** role
   - ✅ Check the permissions in the controller settings

2. **Restricted user**
   - ✅ If you're using a user with limited permissions, some features may not work
   - ✅ Create a user with full permissions

### ❌ The plugin shows "Not connected" even after configuration

**Solutions:**

1. **Check the logs**
   - Check the viewerlog server logs for detailed errors
   - The logs may reveal the exact cause of the problem

2. **Retry the connection**
   - Click **Test connection** again
   - Sometimes a simple retest resolves temporary issues

3. **Check the configuration**
   - Reopen the configuration modal
   - Check that all fields are correctly filled in
   - Save the configuration again

4. **Restart the plugin**
   - Disable the plugin (**Active** switch)
   - Wait a few seconds
   - Re-enable the plugin

### 🔍 Additional checks

If problems persist, check:

- ✅ **UniFi controller version**: Some versions may have compatibility issues
- ✅ **viewerlog version**: Make sure you're using a recent version
- ✅ **Controller logs**: Check the UniFi controller logs for server-side errors
- ✅ **Network connectivity**: Use `ping` or `curl` to test connectivity between viewerlog and the controller

---

## 📚 Additional resources

### Official UniFi documentation

- [UniFi Controller API Documentation](https://help.ui.com/hc/en-us/articles/30076656117655-Getting-Started-with-the-Official-UniFi-API)
- [UniFi Network Application](https://help.ui.com/hc/en-us/categories/360000024273-UniFi-Network-Application)

### Support

If you still have issues after following this guide:

1. Check the viewerlog server logs
2. Check the project documentation on GitHub
3. Open an issue on the GitHub repository with details of your problem

---

## ✅ Configuration checklist

Before considering the configuration complete, check:

- [ ] A local user has been created in the UniFi controller
- [ ] The user has the Full Admin role
- [ ] The user is of type Local (not Cloud)
- [ ] 2FA is disabled for this user (or correctly configured)
- [ ] The controller URL is correct (with `https://` and the port)
- [ ] The username and password are correct
- [ ] The site name is correct (or `default`)
- [ ] The connection test succeeds
- [ ] The configuration is saved
- [ ] The plugin is enabled
- [ ] The status shows "Connected"
- [ ] UniFi data displays on the UniFi page

---

**Last updated**: Version 0.1.12
