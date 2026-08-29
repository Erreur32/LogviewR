# Docker Mount Issue Fix

> 🇫🇷 [Lire en français](./DOCKER_MOUNT_FIX.fr.md)

## 🐛 Problem

Error when starting the container:
```
Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: error mounting "/var/log" to rootfs at "/host/logs": create mountpoint for /host/logs mount: make mountpoint "/host/logs": mkdirat /home/docker/docker_var_lib/overlay2/.../merged/host/logs: read-only file system
```

## 🔍 Cause

Docker tries to create the `/host/logs` mount point but cannot because:
1. The `/host` directory doesn't exist in the image
2. The overlay2 filesystem is read-only during container creation
3. Docker cannot create mount directories on a read-only filesystem

## ✅ Solution

Create the mount directories in the Dockerfile before Docker tries to mount the volumes:

```dockerfile
# Create mount directories for host volumes (avoids mount errors)
# These directories will be mounted by docker-compose with the host volumes
RUN mkdir -p /host/logs /host/proc /host/sys /host/etc /host/usr/bin
```

## 📋 Created directories

- `/host/logs`: For the `/var/log:/host/logs:ro` mount
- `/host/proc`: For the `/proc:/host/proc:ro` mount
- `/host/sys`: For the `/sys:/host/sys:ro` mount
- `/host/etc`: To access the host's `/etc/os-release`
- `/host/usr/bin`: To detect systemd if present

## 🔄 After the fix

The directories exist in the image, so Docker can mount over them with the host volumes without error.

## 📝 Note

The `/:/host:ro` mount should create `/host` automatically, but Docker sometimes tries to create subdirectories before the main mount is applied. Creating the directories in the Dockerfile guarantees they exist before the mounts happen.
