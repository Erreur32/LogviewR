# Correction du problème de montage Docker

## 🐛 Problème

Erreur lors du démarrage du conteneur :
```
Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: error mounting "/var/log" to rootfs at "/host/logs": create mountpoint for /host/logs mount: make mountpoint "/host/logs": mkdirat /home/docker/docker_var_lib/overlay2/.../merged/host/logs: read-only file system
```

## 🔍 Cause

Docker essaie de créer le point de montage `/host/logs` mais ne peut pas car :
1. Le répertoire `/host` n'existe pas dans l'image
2. Le système de fichiers overlay2 est en lecture seule lors de la création du conteneur
3. Docker ne peut pas créer les répertoires de montage dans un système de fichiers en lecture seule

## ✅ Solution

Créer les répertoires de montage dans le Dockerfile avant que Docker n'essaie de monter les volumes :

```dockerfile
# Créer les répertoires de montage pour les volumes host (évite les erreurs de montage)
# Ces répertoires seront montés par docker-compose avec les volumes du host
RUN mkdir -p /host/logs /host/proc /host/sys /host/etc /host/usr/bin
```

## 📋 Répertoires créés

- `/host/logs` : Pour le montage `/var/log:/host/logs:ro`
- `/host/proc` : Pour le montage `/proc:/host/proc:ro`
- `/host/sys` : Pour le montage `/sys:/host/sys:ro`
- `/host/etc` : Pour accéder à `/etc/os-release` du host
- `/host/usr/bin` : Pour détecter systemd si présent

## 🔄 Après la correction

Les répertoires existent dans l'image, donc Docker peut les monter par-dessus avec les volumes du host sans erreur.

## 📝 Note

Le montage `/:/host:ro` devrait créer `/host` automatiquement, mais Docker essaie parfois de créer les sous-répertoires avant que le montage principal ne soit effectué. Créer les répertoires dans le Dockerfile garantit qu'ils existent avant les montages.
