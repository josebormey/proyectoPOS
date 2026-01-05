var db;
var carrito = []; // Carrito de compras

document.addEventListener("deviceready", function() {
  if (window.sqlitePlugin) {
    // En APK o dispositivo real
    db = window.sqlitePlugin.openDatabase({name: 'pos.db', location: 'default'});
  } else {
    // En navegador: usar WebSQL como simulación
    db = window.openDatabase("pos.db", "1.0", "POS DB", 5 * 1024 * 1024);
    console.log("Usando WebSQL en navegador para simular la base de datos");
  }

  // Crear tablas
  db.transaction(function(tx) {
    tx.executeSql("CREATE TABLE IF NOT EXISTS usuarios (id_usuario INTEGER PRIMARY KEY, nombre TEXT, rol TEXT, id_pv INTEGER)");
    tx.executeSql("CREATE TABLE IF NOT EXISTS puntos_venta (id_pv INTEGER PRIMARY KEY, nombre TEXT, ubicacion TEXT)");
    tx.executeSql("CREATE TABLE IF NOT EXISTS productos (id_producto INTEGER PRIMARY KEY, nombre TEXT, precio REAL, stock INTEGER)");
    tx.executeSql("CREATE TABLE IF NOT EXISTS ventas (id_venta INTEGER PRIMARY KEY, id_turno INTEGER, id_usuario INTEGER, fecha TEXT, total REAL)");
    tx.executeSql("CREATE TABLE IF NOT EXISTS ventas_detalle (id_detalle INTEGER PRIMARY KEY, id_venta INTEGER, id_producto INTEGER, cantidad INTEGER, precio REAL)");
    tx.executeSql("CREATE TABLE IF NOT EXISTS entradas (id_entrada INTEGER PRIMARY KEY, id_turno INTEGER, id_usuario INTEGER, id_producto INTEGER, cantidad INTEGER, precio REAL, fecha TEXT)");
    tx.executeSql("CREATE TABLE IF NOT EXISTS turnos (id_turno INTEGER PRIMARY KEY, id_pv INTEGER, id_usuario INTEGER, inicio TEXT, fin TEXT, estado TEXT)");
    tx.executeSql("CREATE TABLE IF NOT EXISTS movimientos_inventario (id_mov INTEGER PRIMARY KEY,tipo TEXT NOT NULL,id_turno INTEGER,id_usuario INTEGER,id_pv INTEGER,id_producto INTEGER,cantidad NUMERIC NOT NULL,fecha TEXT NOT NULL,referencia TEXT,UNIQUE (id_turno, id_usuario, id_producto, fecha, referencia))");
    tx.executeSql("CREATE TABLE IF NOT EXISTS auditoria (id_log INTEGER PRIMARY KEY,accion TEXT NOT NULL,detalle TEXT,id_usuario INTEGER,id_turno INTEGER,fecha TEXT NOT NULL)");
  });

  // Mostrar catálogo y carrito al entrar en ventas
  $(document).on("pageshow", "#ventas", function() {
    mostrarCatalogo();
    mostrarCarrito();
  });
});

// -------------------- CARRITO DE COMPRAS --------------------
function mostrarCatalogo() {
  db.transaction(function(tx) {
    tx.executeSql("SELECT * FROM productos", [], function(tx, res) {
      var html = "";
      for (var i = 0; i < res.rows.length; i++) {
        var p = res.rows.item(i);
        html += `<li>
          ${p.nombre} - $${p.precio}
          <button onclick="agregarAlCarrito(${p.id_producto}, '${p.nombre}', ${p.precio})">Agregar</button>
        </li>`;
      }
      $("#listaProductos").html(html).listview("refresh");
    });
  });
}

function agregarAlCarrito(id, nombre, precio) {
  // Buscar si ya existe en el carrito
  var item = carrito.find(c => c.id === id);
  if (item) {
    item.cantidad += 1;
  } else {
    carrito.push({id, nombre, precio, cantidad: 1});
  }
  mostrarCarrito();
}

function mostrarCarrito() {
  var html = "";
  carrito.forEach(c => {
    html += `<tr><td>${c.nombre}</td><td>${c.cantidad}</td><td>${c.precio}</td></tr>`;
  });
  $("#tablaCarrito tbody").html(html);
}

$("#btnConfirmarVenta").click(function() {
  if (carrito.length === 0) {
    alert("El carrito está vacío");
    return;
  }
  var fecha = new Date().toISOString();
  var total = carrito.reduce((sum, c) => sum + (c.precio * c.cantidad), 0);

  db.transaction(function(tx) {
    tx.executeSql("INSERT INTO ventas (id_turno, id_usuario, fecha, total) VALUES (?, ?, ?, ?)", [1, 1, fecha, total], function(tx, res) {
      var idVenta = res.insertId;
      carrito.forEach(c => {
        tx.executeSql("INSERT INTO ventas_detalle (id_venta, id_producto, cantidad, precio) VALUES (?, ?, ?, ?)", [idVenta, c.id, c.cantidad, c.precio]);
        importarMovimiento({
          tipo: "venta",
          id_turno: 1,
          id_usuario: 1,
          id_pv: 1,
          id_producto: c.id,
          cantidad: c.cantidad,
          fecha: fecha,
          referencia: idVenta
        });
        actualizarStock(c.id, c.cantidad, "venta");
      });
      alert("Venta registrada correctamente");
      carrito = [];
      mostrarCarrito();
    });
  });
});

// -------------------- REGISTRO DE ENTRADAS --------------------
$("#entradaForm").submit(function(e) {
  e.preventDefault();
  var idProducto = $("#productoE").val();
  var cantidad = parseInt($("#cantidadE").val());
  var precio = parseFloat($("#precioE").val());
  var fecha = new Date().toISOString();

  db.transaction(function(tx) {
    tx.executeSql("INSERT INTO entradas (id_turno, id_usuario, id_producto, cantidad, precio, fecha) VALUES (?, ?, ?, ?, ?, ?)", [1, 1, idProducto, cantidad, precio, fecha]);
    importarMovimiento({
      tipo: "entrada",
      id_turno: 1,
      id_usuario: 1,
      id_pv: 1,
      id_producto: idProducto,
      cantidad: cantidad,
      fecha: fecha,
      referencia: "entrada"
    });
    actualizarStock(idProducto, cantidad, "entrada");
  });
});
// -------------------- TURNOS --------------------
$("#abrirTurno").click(function() {
  var inicio = new Date().toISOString();
  db.transaction(function(tx) {
    tx.executeSql("INSERT INTO turnos (id_pv, id_usuario, inicio, estado) VALUES (1, 1, ?, 'abierto')", [inicio]);
  });
});

$("#cerrarTurno").click(function() {
  var fin = new Date().toISOString();
  db.transaction(function(tx) {
    tx.executeSql("UPDATE turnos SET fin=?, estado='cerrado' WHERE id_turno=1", [fin]);
    exportarCierreJSON(1);
    exportarCierreCSV(1);
  });
});

// -------------------- REPORTES --------------------
function mostrarVentasPorTurno(idTurno) {
  db.transaction(function(tx) {
    tx.executeSql("SELECT SUM(total) AS totalVentas FROM ventas WHERE id_turno=?", [idTurno], function(tx, res) {
      var total = res.rows.item(0).totalVentas || 0;
      $("#tablaVentasTurno tbody").html(`<tr><td>${idTurno}</td><td>${total}</td></tr>`);
    });
  });
}

function mostrarEntradasPorTurno(idTurno) {
  db.transaction(function(tx) {
    tx.executeSql("SELECT id_producto, SUM(cantidad) AS totalEntradas FROM entradas WHERE id_turno=? GROUP BY id_producto", [idTurno], function(tx, res) {
      var html = "";
      for (var i = 0; i < res.rows.length; i++) {
        var row = res.rows.item(i);
        html += `<tr><td>${row.id_producto}</td><td>${row.totalEntradas}</td></tr>`;
      }
      $("#tablaEntradasTurno tbody").html(html);
    });
  });
}

function mostrarStock() {
  db.transaction(function(tx) {
    tx.executeSql("SELECT id_producto, SUM(cantidad) AS stockActual FROM movimientos_inventario GROUP BY id_producto", [], function(tx, res) {
      var html = "";
      for (var i = 0; i < res.rows.length; i++) {
        var row = res.rows.item(i);
        html += `<tr><td>${row.id_producto}</td><td>${row.stockActual}</td></tr>`;
      }
      $("#tablaStock tbody").html(html);
    });
  });
}

function mostrarVentasPorVendedor(idTurno) {
  db.transaction(function(tx) {
    tx.executeSql("SELECT id_usuario, SUM(total) AS totalVendedor FROM ventas WHERE id_turno=? GROUP BY id_usuario", [idTurno], function(tx, res) {
      var html = "";
      for (var i = 0; i < res.rows.length; i++) {
        var row = res.rows.item(i);
        html += `<tr><td>${row.id_usuario}</td><td>${row.totalVendedor}</td></tr>`;
      }
      $("#tablaVentasVendedor tbody").html(html);
    });
  });
}

// -------------------- AUDITORÍA --------------------
function registrarAuditoria(accion, detalle, idUsuario, idTurno) {
  var fecha = new Date().toISOString();
  db.transaction(function(tx) {
    tx.executeSql("INSERT INTO auditoria (accion, detalle, id_usuario, id_turno, fecha) VALUES (?, ?, ?, ?, ?)", 
      [accion, detalle, idUsuario, idTurno, fecha]);
  });
}

function mostrarAuditoriaAdmin() {
  db.transaction(function(tx) {
    tx.executeSql("SELECT * FROM auditoria ORDER BY fecha DESC LIMIT 20", [], function(tx, res) {
      var html = "";
      for (var i = 0; i < res.rows.length; i++) {
        var row = res.rows.item(i);
        html += `<tr>
          <td>${row.fecha}</td>
          <td>${row.accion}</td>
          <td>${row.detalle}</td>
          <td>${row.id_usuario}</td>
          <td>${row.id_turno}</td>
        </tr>`;
      }
      $("#tablaAuditoriaAdmin tbody").html(html);
    });
  });
}

// -------------------- BACKUP Y RESTORE --------------------
function backupDatabase() {
  var sourcePath = cordova.file.applicationStorageDirectory + "databases/pos.db";
  var targetPath = cordova.file.externalDataDirectory + "backup_pos.db";

  window.resolveLocalFileSystemURL(sourcePath, function(fileEntry) {
    fileEntry.copyTo(
      window.resolveLocalFileSystemURL(cordova.file.externalDataDirectory, function(dir) {
        fileEntry.copyTo(dir, "backup_pos.db", function() {
          alert("Backup generado en almacenamiento externo");
          registrarAuditoria("backup", "Base de datos respaldada", 1, 1);
        }, function(err) {
          console.error("Error en backup", err);
        });
      })
    );
  });
}

function restoreDatabase() {
  var backupPath = cordova.file.externalDataDirectory + "backup_pos.db";
  var targetPath = cordova.file.applicationStorageDirectory + "databases/pos.db";

  window.resolveLocalFileSystemURL(backupPath, function(fileEntry) {
    fileEntry.copyTo(
      window.resolveLocalFileSystemURL(cordova.file.applicationStorageDirectory + "databases/", function(dir) {
        fileEntry.copyTo(dir, "pos.db", function() {
          alert("Base de datos restaurada desde backup");
          registrarAuditoria("restauracion", "Base de datos restaurada", 1, 1);
        }, function(err) {
          console.error("Error en restauración", err);
        });
      })
    );
  });
}

// -------------------- PROTECCIÓN DE ACCESO --------------------
$(document).on("pageshow", "#home", function() {
  if (!sessionStorage.getItem("rol")) {
    $.mobile.changePage("#login");
  }
});
