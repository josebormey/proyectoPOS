var db;

document.addEventListener("deviceready", function() {
  db = window.sqlitePlugin.openDatabase({name: 'pos.db', location: 'default'});

  // Crear tablas con validación de duplicados
  db.transaction(function(tx) {
    tx.executeSql("CREATE TABLE IF NOT EXISTS usuarios (id_usuario INTEGER PRIMARY KEY, nombre TEXT, rol TEXT, id_pv INTEGER)");
    tx.executeSql("CREATE TABLE IF NOT EXISTS puntos_venta (id_pv INTEGER PRIMARY KEY, nombre TEXT, ubicacion TEXT)");
    tx.executeSql("CREATE TABLE IF NOT EXISTS productos (id_producto INTEGER PRIMARY KEY, nombre TEXT, precio REAL, stock INTEGER)");
    tx.executeSql("CREATE TABLE IF NOT EXISTS ventas (id_venta INTEGER PRIMARY KEY, id_turno INTEGER, id_usuario INTEGER, fecha TEXT, total REAL)");
    tx.executeSql("CREATE TABLE IF NOT EXISTS ventas_detalle (id_detalle INTEGER PRIMARY KEY, id_venta INTEGER, id_producto INTEGER, cantidad INTEGER, precio REAL)");
    tx.executeSql("CREATE TABLE IF NOT EXISTS entradas (id_entrada INTEGER PRIMARY KEY, id_turno INTEGER, id_usuario INTEGER, id_producto INTEGER, cantidad INTEGER, precio REAL, fecha TEXT)");
    tx.executeSql("CREATE TABLE IF NOT EXISTS turnos (id_turno INTEGER PRIMARY KEY, id_pv INTEGER, id_usuario INTEGER, inicio TEXT, fin TEXT, estado TEXT)");
    tx.executeSql("CREATE TABLE IF NOT EXISTS movimientos_inventario (id_mov INTEGER PRIMARY KEY,tipo TEXT NOT NULL,id_turno INTEGER,id_usuario INTEGER,id_pv INTEGER,id_producto INTEGER,cantidad NUMERIC NOT NULL,fecha TEXT NOT NULL,referencia TEXT,UNIQUE (id_turno, id_usuario, id_producto, fecha, referencia)}");
    tx.executeSql("CREATE TABLE IF NOT EXISTS auditoria (id_log INTEGER PRIMARY KEY,accion TEXT NOT NULL,detalle TEXT,id_usuario INTEGER,id_turno INTEGER,fecha TEXT NOT NULL)");
});

// -------------------- REGISTRO DE VENTAS --------------------
$("#ventaForm").submit(function(e) {
  e.preventDefault();
  var idProducto = $("#producto").val();
  var cantidad = parseInt($("#cantidad").val());
  var precio = parseFloat($("#precio").val());
  var fecha = new Date().toISOString();
  var total = cantidad * precio;

  db.transaction(function(tx) {
    tx.executeSql("INSERT INTO ventas (id_turno, id_usuario, fecha, total) VALUES (?, ?, ?, ?)", [1, 1, fecha, total], function(tx, res) {
      var idVenta = res.insertId;
      tx.executeSql("INSERT INTO ventas_detalle (id_venta, id_producto, cantidad, precio) VALUES (?, ?, ?, ?)", [idVenta, idProducto, cantidad, precio]);
      importarMovimiento({
        tipo: "venta",
        id_turno: 1,
        id_usuario: 1,
        id_pv: 1,
        id_producto: idProducto,
        cantidad: cantidad,
        fecha: fecha,
        referencia: idVenta
      });
      actualizarStock(idProducto, cantidad, "venta");
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

// Botón exportar CSV
$(document).on("click", "#btnExportCSV", function() {
  exportarReporteCSV();
  alert("Reporte CSV generado en almacenamiento externo");
});

// Botón exportar PDF
$(document).on("click", "#btnExportPDF", function() {
  exportarReportePDF();
  alert("Reporte PDF generado y disponible para descarga");
});

// Botones de compartir
$(document).on("click", "#btnShareCSV", function() {
  compartirReporteCSV();
});

$(document).on("click", "#btnSharePDF", function() {
  compartirReportePDF();
});

$(document).on("click", "#btnBackup", function() {
  backupDatabase();
});

$(document).on("click", "#btnRestore", function() {
  restoreDatabase();
});

$("#loginForm").submit(function(e) {
  e.preventDefault();
  var usuario = $("#user").val();
  var pass = $("#pass").val();

  db.transaction(function(tx) {
    tx.executeSql("SELECT * FROM usuarios WHERE nombre=? AND rol IS NOT NULL", [usuario], function(tx, res) {
      if (res.rows.length > 0) {
        var user = res.rows.item(0);
        sessionStorage.setItem("rol", user.rol);
        $.mobile.changePage("#home");
        aplicarRestriccionesPorRol(user.rol);
      } else {
        alert("Usuario no válido");
      }
    });
  });

$(document).on("click", "#btnSync", function() {
  var file = document.getElementById("fileSync").files[0];
  if (file) {
    var reader = new FileReader();
    reader.onloadend = function() {
      try {
        var datos = JSON.parse(this.result);
        datos.forEach(m => importarMovimiento(m));
        alert("Sincronización completada");
        registrarAuditoria("sincronizacion", "Archivo sincronizado manualmente", 1, 1);
      } catch (e) {
        alert("Error en archivo de sincronización");
      }
    };
    reader.readAsText(file);
  } else {
    alert("Debe seleccionar un archivo");
  }
});

// Al entrar al panel de administración
$(document).on("pageshow", "#adminPanel", function() {
  mostrarUsuarios();
  mostrarPV();
  mostrarStockGlobal();
  mostrarAuditoriaAdmin();
});

// Crear usuario
$("#formUsuario").submit(function(e) {
  e.preventDefault();
  var nombre = $("#nombreUsuario").val();
  var rol = $("#rolUsuario").val();
  var pv = $("#pvUsuario").val();

  db.transaction(function(tx) {
    tx.executeSql("INSERT INTO usuarios (nombre, rol, id_pv) VALUES (?, ?, ?)", [nombre, rol, pv], function() {
      alert("Usuario creado");
      mostrarUsuarios();
      registrarAuditoria("crear_usuario", `Usuario ${nombre} rol ${rol}`, 1, 1);
    });
  });
});

// Editar usuario
$("#btnEditarUsuario").click(function() {
  var id = $("#idUsuarioAccion").val();
  var nuevoRol = prompt("Nuevo rol (admin/vendedor):");
  var nuevoPv = prompt("Nuevo ID de Punto de Venta:");

  if (id && nuevoRol && nuevoPv) {
    db.transaction(function(tx) {
      tx.executeSql("UPDATE usuarios SET rol=?, id_pv=? WHERE id_usuario=?", [nuevoRol, nuevoPv, id], function() {
        alert("Usuario actualizado");
        mostrarUsuarios();
        registrarAuditoria("editar_usuario", `Usuario ${id} rol ${nuevoRol}`, 1, 1);
      });
    });
  }
});

// Eliminar usuario
$("#btnEliminarUsuario").click(function() {
  var id = $("#idUsuarioAccion").val();
  if (id) {
    db.transaction(function(tx) {
      tx.executeSql("DELETE FROM usuarios WHERE id_usuario=?", [id], function() {
        alert("Usuario eliminado");
        mostrarUsuarios();
        registrarAuditoria("eliminar_usuario", `Usuario ${id} eliminado`, 1, 1);
      });
    });
  }
});

// Crear producto
$("#formProducto").submit(function(e) {
  e.preventDefault();
  var nombre = $("#nombreProducto").val();
  var precio = $("#precioProducto").val();
  var stock = $("#stockProducto").val();

  db.transaction(function(tx) {
    tx.executeSql("INSERT INTO productos (nombre, precio, stock) VALUES (?, ?, ?)", [nombre, precio, stock], function() {
      alert("Producto creado");
      mostrarStockGlobal();
      registrarAuditoria("crear_producto", `Producto ${nombre} creado`, 1, 1);
    });
  });
});

// Editar producto
$("#btnEditarProducto").click(function() {
  var id = $("#idProductoAccion").val();
  var nuevoPrecio = prompt("Nuevo precio:");
  var nuevoStock = prompt("Nuevo stock:");

  if (id && nuevoPrecio && nuevoStock) {
    db.transaction(function(tx) {
      tx.executeSql("UPDATE productos SET precio=?, stock=? WHERE id_producto=?", [nuevoPrecio, nuevoStock, id], function() {
        alert("Producto actualizado");
        mostrarStockGlobal();
        registrarAuditoria("editar_producto", `Producto ${id} actualizado`, 1, 1);
      });
    });
  }
});

// Eliminar producto
$("#btnEliminarProducto").click(function() {
  var id = $("#idProductoAccion").val();
  if (id) {
    db.transaction(function(tx) {
      tx.executeSql("DELETE FROM productos WHERE id_producto=?", [id], function() {
        alert("Producto eliminado");
        mostrarStockGlobal();
        registrarAuditoria("eliminar_producto", `Producto ${id} eliminado`, 1, 1);
      });
    });
  }
});

// Crear punto de venta
$("#formPV").submit(function(e) {
  e.preventDefault();
  var nombre = $("#nombrePV").val();
  var ubicacion = $("#ubicacionPV").val();

  db.transaction(function(tx) {
    tx.executeSql("INSERT INTO puntos_venta (nombre, ubicacion) VALUES (?, ?)", [nombre, ubicacion], function() {
      alert("Punto de venta creado");
      mostrarPV();
      registrarAuditoria("crear_pv", `PV ${nombre} creado`, 1, 1);
    });
  });
});

// Editar punto de venta
$("#btnEditarPV").click(function() {
  var id = $("#idPVAccion").val();
  var nuevoNombre = prompt("Nuevo nombre del PV:");
  var nuevaUbicacion = prompt("Nueva ubicación del PV:");

  if (id && nuevoNombre && nuevaUbicacion) {
    db.transaction(function(tx) {
      tx.executeSql("UPDATE puntos_venta SET nombre=?, ubicacion=? WHERE id_pv=?", [nuevoNombre, nuevaUbicacion, id], function() {
        alert("Punto de venta actualizado");
        mostrarPV();
        registrarAuditoria("editar_pv", `PV ${id} actualizado`, 1, 1);
      });
    });
  }
});

// Eliminar punto de venta
$("#btnEliminarPV").click(function() {
  var id = $("#idPVAccion").val();
  if (id) {
    db.transaction(function(tx) {
      tx.executeSql("DELETE FROM puntos_venta WHERE id_pv=?", [id], function() {
        alert("Punto de venta eliminado");
        mostrarPV();
        registrarAuditoria("eliminar_pv", `PV ${id} eliminado`, 1, 1);
      });
    });
  }
});

// Abrir turno desde panel
$("#formTurno").submit(function(e) {
  e.preventDefault();
  var usuario = $("#usuarioTurno").val();
  var pv = $("#pvTurno").val();
  var fechaApertura = new Date().toISOString();

  db.transaction(function(tx) {
    tx.executeSql("INSERT INTO turnos (id_usuario, id_pv, estado, fecha_apertura) VALUES (?, ?, 'abierto', ?)", 
      [usuario, pv, fechaApertura], function() {
        alert("Turno abierto");
        mostrarTurnosAdmin();
        registrarAuditoria("abrir_turno", `Turno abierto usuario ${usuario}`, usuario, 1);
      });
  });
});

// Cerrar turno desde panel
$("#btnCerrarTurnoAdmin").click(function() {
  var id = $("#idTurnoAccion").val();
  var fechaCierre = new Date().toISOString();

  if (id) {
    db.transaction(function(tx) {
      tx.executeSql("UPDATE turnos SET estado='cerrado', fecha_cierre=? WHERE id_turno=?", [fechaCierre, id], function() {
        alert("Turno cerrado");
        mostrarTurnosAdmin();
        registrarAuditoria("cerrar_turno", `Turno ${id} cerrado`, 1, id);
      });
    });
  }
});

// Mostrar turnos en panel
function mostrarTurnosAdmin() {
  db.transaction(function(tx) {
    tx.executeSql("SELECT * FROM turnos ORDER BY fecha_apertura DESC", [], function(tx, res) {
      var html = "";
      for (var i = 0; i < res.rows.length; i++) {
        var row = res.rows.item(i);
        html += `<tr>
          <td>${row.id_turno}</td>
          <td>${row.id_usuario}</td>
          <td>${row.id_pv}</td>
          <td>${row.estado}</td>
          <td>${row.fecha_apertura}</td>
          <td>${row.fecha_cierre || ""}</td>
        </tr>`;
      }
      $("#tablaTurnosAdmin tbody").html(html);
    });
  });
}

// Al entrar al panel de administración, refrescar turnos
$(document).on("pageshow", "#adminPanel", function() {
  mostrarTurnosAdmin();
});

// Aplicar filtros de auditoría
$("#formFiltroAuditoria").submit(function(e) {
  e.preventDefault();
  var usuario = $("#filtroUsuario").val();
  var accion = $("#filtroAccion").val();
  var desde = $("#filtroDesde").val();
  var hasta = $("#filtroHasta").val();

  var query = "SELECT * FROM auditoria WHERE 1=1";
  var params = [];

  if (usuario) {
    query += " AND id_usuario=?";
    params.push(usuario);
  }
  if (accion) {
    query += " AND accion LIKE ?";
    params.push("%" + accion + "%");
  }
  if (desde) {
    query += " AND fecha >= ?";
    params.push(desde);
  }
  if (hasta) {
    query += " AND fecha <= ?";
    params.push(hasta);
  }

  query += " ORDER BY fecha DESC";

  db.transaction(function(tx) {
    tx.executeSql(query, params, function(tx, res) {
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
});

// -------------------- EXPORTACIÓN --------------------
function exportarCierreJSON(idTurno) {
  db.transaction(function(tx) {
    tx.executeSql("SELECT * FROM movimientos_inventario WHERE id_turno=?", [idTurno], function(tx, res) {
      var movimientos = [];
      for (var i = 0; i < res.rows.length; i++) {
        movimientos.push(res.rows.item(i));
      }
      var cierreJSON = JSON.stringify(movimientos, null, 2);

      window.resolveLocalFileSystemURL(cordova.file.externalDataDirectory, function(dir) {
        dir.getFile("cierre_turno_" + idTurno + ".json", {create:true}, function(file) {
          file.createWriter(function(writer) {
            writer.write(cierreJSON);
            console.log("Archivo JSON de cierre generado");
          });
        });
      });
    });
  });
}

function exportarCierreCSV(idTurno) {
  db.transaction(function(tx) {
    tx.executeSql("SELECT * FROM movimientos_inventario WHERE id_turno=?", [idTurno], function(tx, res) {
      var csv = "tipo,id_turno,id_usuario,id_pv,id_producto,cantidad,fecha,referencia\n";
      for (var i = 0; i < res.rows.length; i++) {
        var row = res.rows.item(i);
        csv += `${row.tipo},${row.id_turno},${row.id_usuario},${row.id_pv},${row.id_producto},${row.cantidad},${row.fecha},${row.referencia}\n`;
      }

      window.resolveLocalFileSystemURL(cordova.file.externalDataDirectory, function(dir) {
        dir.getFile("cierre_turno_" + idTurno + ".csv", {create:true}, function(file) {
          file.createWriter(function(writer) {
            writer.write(csv);
            console.log("Archivo CSV de cierre generado");
          });
        });
      });
    });
  });
}

// -------------------- IMPORTACIÓN --------------------
function importarCierreJSON(fileEntry) {
  fileEntry.file(function(file) {
    var reader = new FileReader();
    reader.onloadend = function() {
      var movimientos = JSON.parse(this.result);
      movimientos.forEach(m => {
        importarMovimiento(m);
      });
    };
    reader.readAsText(file);
  });
}

// -------------------- VALIDACIÓN DE MOVIMIENTOS --------------------
function importarMovimiento(m) {
  db.transaction(function(tx) {
    tx.executeSql("SELECT COUNT(*) AS existe FROM movimientos_inventario WHERE id_turno=? AND id_usuario=? AND id_producto=? AND fecha=? AND referencia=?",
      [m.id_turno, m.id_usuario, m.id_producto, m.fecha, m.referencia],
      function(tx, res) {
        if (res.rows.item(0).existe === 0) {
          tx.executeSql("INSERT INTO movimientos_inventario (tipo, id_turno, id_usuario, id_pv, id_producto, cantidad, fecha, referencia) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [m.tipo, m.id_turno, m.id_usuario, m.id_pv, m.id_producto, m.cantidad, m.fecha, m.referencia]);
          actualizarStock(m.id_producto, m.cantidad, m.tipo);
        } else {
          console.log("Movimiento duplicado ignorado:", m);
        }
      });
  });
}

// -------------------- VALIDACIÓN DE USUARIO Y PV --------------------
function validarUsuarioYPV(idUsuario, idPv, callback) {
  db.transaction(function(tx) {
    tx.executeSql("SELECT COUNT(*) AS u FROM usuarios WHERE id_usuario=?", [idUsuario], function(tx, resU) {
      tx.executeSql("SELECT COUNT(*) AS p FROM puntos_venta WHERE id_pv=?", [idPv], function(tx, resP) {
        if (resU.rows.item(0).u > 0 && resP.rows.item(0).p > 0) {
          callback(true);
        } else {
          callback(false);
        }
      });
    });
  });
}

// -------------------- ACTUALIZACIÓN DE STOCK --------------------
function actualizarStock(idProducto, cantidad, tipo) {
  var delta = (tipo === "entrada") ? cantidad : -cantidad;
  db.transaction(function(tx) {
    tx.executeSql("UPDATE productos SET stock = stock + ? WHERE id_producto=?", [delta, idProducto]);
  });
}

// -------------------- REPORTES --------------------
// Ventas por turno
function mostrarVentasPorTurno(idTurno) {
  db.transaction(function(tx) {
    tx.executeSql("SELECT SUM(total) AS totalVentas FROM ventas WHERE id_turno=?", [idTurno], function(tx, res) {
      var total = res.rows.item(0).totalVentas || 0;
      $("#tablaVentasTurno tbody").html(`<tr><td>${idTurno}</td><td>${total}</td></tr>`);
    });
  });
}

// Entradas por turno
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

// Stock actual
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

// Ventas por vendedor
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

// Mostrar resultado de importación
function mostrarResultadoImportacion(m, estado) {
  if (estado === "importado") {
    $("#listaImportados").append(`<li>${m.tipo} - Prod:${m.id_producto} - Cant:${m.cantidad}</li>`).listview("refresh");
  } else if (estado === "duplicado") {
    $("#listaDuplicados").append(`<li>${m.tipo} - Prod:${m.id_producto} - Cant:${m.cantidad}</li>`).listview("refresh");
  } else if (estado === "error") {
    $("#listaErrores").append(`<li>${m.tipo} - Prod:${m.id_producto} - ERROR</li>`).listview("refresh");
  }
}

// Importar movimiento con validación extendida
function importarMovimiento(m) {
  validarUsuarioYPV(m.id_usuario, m.id_pv, function(valido) {
    if (!valido) {
      mostrarResultadoImportacion(m, "error");
      return;
    }

    db.transaction(function(tx) {
      tx.executeSql("SELECT COUNT(*) AS existe FROM movimientos_inventario WHERE id_turno=? AND id_usuario=? AND id_producto=? AND fecha=? AND referencia=?",
        [m.id_turno, m.id_usuario, m.id_producto, m.fecha, m.referencia],
        function(tx, res) {
          if (res.rows.item(0).existe === 0) {
            tx.executeSql("INSERT INTO movimientos_inventario (tipo, id_turno, id_usuario, id_pv, id_producto, cantidad, fecha, referencia) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              [m.tipo, m.id_turno, m.id_usuario, m.id_pv, m.id_producto, m.cantidad, m.fecha, m.referencia]);
            actualizarStock(m.id_producto, m.cantidad, m.tipo);
            mostrarResultadoImportacion(m, "importado");
          } else {
            mostrarResultadoImportacion(m, "duplicado");
          }
        });
    });
  });
}
function exportarReporteCSV() {
  db.transaction(function(tx) {
    tx.executeSql("SELECT id_producto, SUM(cantidad) AS stockActual FROM movimientos_inventario GROUP BY id_producto", [], function(tx, res) {
      var csv = "Producto,Stock\n";
      for (var i = 0; i < res.rows.length; i++) {
        var row = res.rows.item(i);
        csv += `${row.id_producto},${row.stockActual}\n`;
      }

      window.resolveLocalFileSystemURL(cordova.file.externalDataDirectory, function(dir) {
        dir.getFile("reporte_stock.csv", {create:true}, function(file) {
          file.createWriter(function(writer) {
            writer.write(csv);
            console.log("Reporte CSV generado");
          });
        });
      });
    });
  });
}
function exportarReportePDF() {
  db.transaction(function(tx) {
    tx.executeSql("SELECT id_usuario, SUM(total) AS totalVendedor FROM ventas GROUP BY id_usuario", [], function(tx, res) {
      var body = [["Vendedor", "Total Ventas"]];
      for (var i = 0; i < res.rows.length; i++) {
        var row = res.rows.item(i);
        body.push([row.id_usuario.toString(), row.totalVendedor.toString()]);
      }

      var docDefinition = {
        content: [
          { text: 'Reporte de Ventas por Vendedor', style: 'header' },
          { table: { body: body } }
        ]
      };

      pdfMake.createPdf(docDefinition).download("reporte_ventas.pdf");
    });
  });
}

// Compartir CSV
function compartirReporteCSV() {
  var filePath = cordova.file.externalDataDirectory + "reporte_stock.csv";
  window.plugins.socialsharing.share(
    "Reporte de Stock en CSV",
    "Reporte CSV",
    filePath,
    null
  );
}

// Compartir PDF
function compartirReportePDF() {
  var filePath = cordova.file.externalDataDirectory + "reporte_ventas.pdf";
  window.plugins.socialsharing.share(
    "Reporte de Ventas en PDF",
    "Reporte PDF",
    filePath,
    null
  );
}



function aplicarRestriccionesPorRol(rol) {
  if (rol === "vendedor") {
    // Ocultar botones de administrador
    $("#home a[href='#reportes']").hide();
    $("#home a[href='#turnos']").hide();
    $("#home a[href='#validacion']").hide();
    $("#home a[href='#exportacion']").hide();
    $("#home a[href='#compartir']").hide();
  } else if (rol === "admin") {
    // Mostrar todo
    $("#home a").show();
  }
}

// -------------------- AUDITORÍA -------------------- 
function registrarAuditoria(accion, detalle, idUsuario, idTurno) { 
var fecha = new Date().toISOString(); 
db.transaction(function(tx) {
	tx.executeSql("INSERT INTO auditoria (accion, detalle, id_usuario, id_turno, fecha) VALUES (?, ?, ?, ?, ?)", 
	[accion, detalle, idUsuario, idTurno, fecha]); }); 
	} 


function mostrarAuditoria() { 
  db.transaction(function(tx) { 
  tx.executeSql("SELECT * FROM auditoria ORDER BY fecha DESC", [], function(tx, res) { 
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
	$("#tablaAuditoria tbody").html(html); 
	}); 
	}); 
}

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

function sincronizarArchivo(fileEntry) {
  fileEntry.file(function(file) {
    var reader = new FileReader();
    reader.onloadend = function() {
      try {
        var datos = JSON.parse(this.result);
        if (Array.isArray(datos)) {
          datos.forEach(m => {
            importarMovimiento(m);
          });
          alert("Sincronización completada");
          registrarAuditoria("sincronizacion", "Archivo sincronizado manualmente", 1, 1);
        } else {
          alert("Formato de archivo inválido");
        }
      } catch (e) {
        alert("Error al leer archivo de sincronización");
      }
    };
    reader.readAsText(file);
  });
}

function mostrarUsuarios() {
  db.transaction(function(tx) {
    tx.executeSql("SELECT * FROM usuarios", [], function(tx, res) {
      var html = "";
      for (var i = 0; i < res.rows.length; i++) {
        var row = res.rows.item(i);
        html += `<tr><td>${row.id_usuario}</td><td>${row.nombre}</td><td>${row.rol}</td><td>${row.id_pv}</td></tr>`;
      }
      $("#tablaUsuarios tbody").html(html);
    });
  });
}

function mostrarPV() {
  db.transaction(function(tx) {
    tx.executeSql("SELECT * FROM puntos_venta", [], function(tx, res) {
      var html = "";
      for (var i = 0; i < res.rows.length; i++) {
        var row = res.rows.item(i);
        html += `<tr><td>${row.id_pv}</td><td>${row.nombre}</td><td>${row.ubicacion}</td></tr>`;
      }
      $("#tablaPV tbody").html(html);
    });
  });
}

function mostrarStockGlobal() {
  db.transaction(function(tx) {
    tx.executeSql("SELECT id_producto, SUM(cantidad) AS stockActual FROM movimientos_inventario GROUP BY id_producto", [], function(tx, res) {
      var html = "";
      for (var i = 0; i < res.rows.length; i++) {
        var row = res.rows.item(i);
        html += `<tr><td>${row.id_producto}</td><td>${row.stockActual}</td></tr>`;
      }
      $("#tablaStockGlobal tbody").html(html);
    });
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




