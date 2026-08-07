// Mensajes y detección de Docker dependientes del SO.
//
// En Windows/macOS el "producto" que hay que tener abierto es Docker Desktop;
// en Linux no existe tal cosa: el daemon corre como servicio (systemd) y el
// fallo típico NO es "está apagado" sino que el usuario no pertenece al grupo
// `docker` y no puede abrir /var/run/docker.sock.

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const HAS_DESKTOP = IS_WIN || IS_MAC;

// Nombre de lo que hay que arrancar, para usar dentro de frases.
const DOCKER_APP = HAS_DESKTOP ? 'Docker Desktop' : 'el daemon de Docker';

// Cómo se instala en este SO.
const INSTALL_HINT = HAS_DESKTOP
  ? 'Instala Docker Desktop.'
  : 'Instala Docker Engine (por ejemplo: sudo apt install docker.io).';

// Pregunta accionable cuando docker falla y no sabemos la causa exacta.
const RUNNING_QUESTION = HAS_DESKTOP
  ? '¿Docker Desktop está abierto?'
  : '¿El daemon está corriendo? Compruébalo con: systemctl status docker';

// Fallo de permisos sobre el socket: arrancar el daemon no lo arregla.
const GROUP_HINT =
  'Permiso denegado sobre el socket de Docker. Añade tu usuario al grupo docker con ' +
  '`sudo usermod -aG docker $USER`, cierra la sesión y vuelve a entrar, y reinicia el backend ' +
  'para que el proceso herede el grupo nuevo.';

// Reconoce el error de socket de Docker en cualquiera de sus redacciones
// ("...connect to the docker API at unix:///var/run/docker.sock", "dial unix
// /var/run/docker.sock: connect: permission denied").
function isSocketPermissionError(text) {
  const s = String(text || '');
  return /permission denied/i.test(s) && /docker\.sock|docker API|docker daemon/i.test(s);
}

// Sufijo accionable para un error de docker, según lo que diga su stderr.
function dockerFailHint(text) {
  return isSocketPermissionError(text) ? GROUP_HINT : RUNNING_QUESTION;
}

module.exports = {
  IS_WIN, IS_MAC, HAS_DESKTOP,
  DOCKER_APP, INSTALL_HINT, RUNNING_QUESTION, GROUP_HINT,
  isSocketPermissionError, dockerFailHint,
};
