Messages = new Meteor.Collection('messages');

Router.map(function () {
  var monthAgo = moment().subtract('months', 1);

  this.route('auth', {
    path: '/auth'
  });

  this.route('auth2', {
    path: '/auth2',
    before: function () {
      console.log(this.params.email);
      Meteor.call('authenticate2', this.params.name, this.params.email, this.params.nonce, this.params.hash,
        function (err, res) {
        if (err) {
          $('#message').text('Error: ' + err);
          return;
        }

        console.log(res);

        // Store our credentials
        amplify.store('blabberlive', res);
//        console.log(amplify);
        $('#message').html('Thank you. You should now be able to post from this site. <a href="/">Go back</a>.');
      });
    }
  });

  this.route('home', {
    path: '/',
    before: function () {
      this.subscribe('threadRoots').wait();
      Meteor.call('authorize', amplify.store('blabberlive'), function (err, res) {
        if (err) {
          console.log('authorize error: ' + err);
          Session.set('mayPost', null);
          return;
        }
        Session.set('mayPost', res);
      });
    },
    data: function () {
      return {
        threads: Messages.find({
          parent: null,
          threadLastDate: {$gt: monthAgo}
        }, {sort: {threadLastDate: -1}})
      };
    }
  });

  this.route('thread', {
    path: '/thread/:_id',
    before: function () {
      Meteor.call('authorize', amplify.store('blabberlive'), function (err, res) {
        if (err) {
          console.log('authorize error: ' + err);
          Session.set('mayPost', null);
          return;
        }
        Session.set('mayPost', res);
      });
      this.subscribe('threadMessages', this.params._id).wait();
      this.subscribe('threadRoots').wait();
    },
    data: function () {
      var parent = this.params._id;
      var parentMessage = Messages.findOne({parent: null, _id: parent});
      var messages = Messages.find({thread: parent}, {sort: {receivedDate: 1}});
      return {
        parentMessage: parentMessage,
        messages: messages,
        messageCount: messages.count(),
        parent: parent
      };
    }
  });

  this.route('source', {
    path: '/source/:_id',
    before: function () {
      this.subscribe('messageById', this.params._id).wait();
    },
    data: function () {
      return Messages.findOne({_id: this.params._id});
    }
  });
});

if (Meteor.isClient) {
  $(function () {
    $(document).tooltip({
      track: false,
      show: {
        effect: "show",
        delay: 0
      },
      hide: {
        effect: "hide",
        delay: 0
      }
    });
  });

  Template.auth.events({
    'submit': function () {
      var emailField = $('input#authEmail');
      var submitField = $('form#authForm input[type="submit"]');
      var email = emailField.val();
      var nameField = $('input#authName');
      var name = nameField.val()
      if (!email || !name) {
        return false;
      }

      // Generate URL for the email
      // It's easier in the browser
      var url = window.location.protocol + '//'
        + window.location.host;

      Meteor.call('authenticate', name, email, url, function (err, res) {
        if (err) {
          console.log("error: " + err);
          nameField.prop('disabled', false);
          emailField.prop('disabled', false);
          submitField.prop('disabled', false);
          return;
        }
        emailField.val('Please check your inbox (' + email + ')');
      });
      nameField.prop('disabled', true);
      emailField.prop('disabled', true);
      submitField.prop('disabled', true);

      return false;
    }
  });

  Template.thread.events({
    'submit form#replyForm': function () {
      var bodyField = $('form#replyForm textarea#replyBody');
      var submitButton = $('form#replyForm input[type="submit"]');

      var body = bodyField.val();

      if (!body) {
        return false;
      }

      bodyField.prop('disabled', true);
      submitButton.prop('disabled', true);
      submitButton.val('Replying…');

      Meteor.call('reply', amplify.store('blabberlive'),
        this.parent, body, function (err, res) {
          if (err) {
            console.log('reply error: ' + err);
            bodyField.prop('disabled', false);
            submitButton.prop('disabled', false);
            return false;
          }

          bodyField.val('');
          submitButton.val('Reply');
          bodyField.prop('disabled', false);
          submitButton.prop('disabled', false);
      });

      return false;
    }
  });

  Template.home.events({
    'click #postDiv > p': function () {
      $('#postForm').toggle(100);
    },
    'submit form#postForm': function () {
      console.log('submitted');
      var subjectField = $('form#postForm input#postSubject');
      var bodyField = $('form#postForm textarea#postBody');
      var submitButton = $('form#postForm input[type="submit"]');

      var subject = subjectField.val();
      var body = bodyField.val();

      if (!subject || !body) {
        return false;
      }

      subjectField.prop('disabled', true);
      bodyField.prop('disabled', true);
      submitButton.prop('disabled', true);
      submitButton.val('Posting…');

      Meteor.call('post', amplify.store('blabberlive'),
        subject, body, function (err, res) {
          if (err) {
            console.log('reply error: ' + err);
            bodyField.prop('disabled', false);
            submitButton.prop('disabled', false);
            return false;
          }

          subjectField.val('');
          bodyField.val('');
          submitButton.val('Post');
          bodyField.prop('disabled', false);
          submitButton.prop('disabled', false);
          $('#postForm').hide(100);
      });

      return false;
    }
  });

  Template.thread.mayPost = function () {
    return Session.get('mayPost');
  }

  Template.home.mayPost = function () {
    return Session.get('mayPost');
  }

  Template.thread.mayPostEmail = function () {
    return Session.set('mayPostEmail');
  }

  Handlebars.registerHelper('formatDate', function (date) {
    return moment(date).format('MM/DD HH:mm');
  });

  Handlebars.registerHelper('formatLongDate', function (date) {
    return moment(date).format('YYYY-MM-DD H:mm:ss');
  });

  Handlebars.registerHelper('threadCount', function (children) {
    return children.length + 1;
  });

  marked.setOptions({
    gfm: true,
    breaks: false,
    tables: false,
    sanitize: true
  });

  Handlebars.registerHelper('marked', function (md) {
    return marked(md);
  });

}

if (Meteor.isServer) {
  Meteor.startup(function () {
    Messages._ensureIndex({receivedDate: 1});
    Messages._ensureIndex({receivedDate: -1});
    Messages._ensureIndex({parent: 1, threadLastDate: -1});
    Messages._ensureIndex({thread: 1, receivedDate: 1});
    Messages._ensureIndex({fromEmail: 1});
    Messages._ensureIndex({subject: 1});
    Messages._ensureIndex({messageIdSha1: 1});

    var monthAgo = new Date(moment().subtract('months', 1));

    console.log(monthAgo);

    Meteor.publish('threadMessages', function (parent) {
      return Messages.find({thread: parent}, {sort: {receivedDate: 1}});
    });

    Meteor.publish('threadRoots', function () {
      return Messages.find({
        parent: null,
        threadLastDate: {$gt: monthAgo}
      }, {
        sort: {threadLastDate: -1}
      });
    });

    Meteor.publish('messageById', function (_id) {
      return Messages.find({_id: _id});
    });
    
    Messages.allow({
      insert: function (userId, party) {
        return false;
      }
    });

    var authToken = process.env.REST_TOKEN;
    console.log("REST auth token is " + authToken);

    collectionApi = new CollectionAPI({
      authToken: authToken,
      apiPath: 'collectionapi',
      standAlone: false,
      listenHost: '127.0.0.1'
    });

    collectionApi.addCollection(Messages, 'messages', {
      authToken: authToken,
      methods: ['POST','GET'],
      before: {
        POST: function (obj) {
          obj.date = new Date(obj.date);
          obj.receivedDate = new Date(obj.receivedDate);
          obj.threadFirstDate = obj.receivedDate;
          obj.threadLastDate = obj.receivedDate;
          obj.threadLastMessage = JSON.parse(JSON.stringify(obj));
          obj.thread = obj._id;

          // need to check for existence before we start messing with the tree
          if (Messages.findOne({_id: obj._id})) {
            // already exists
            console.log(obj._id + ' already exists');
            return false;
          }

          // Run the JWZ threading algorithm, flattened version

          var parent, parentId;

          // walk through the references, left to right, to find a parent
          // unlike JWZ, we are only interested in ultimate parents,
          // hence left to right
          if (obj.references.length) {
            var refCount = obj.references.length - 1;
            for (var i = 0; i < refCount && !parent; i++) {
              var potentialParentId = obj.references[i];
              var potentialParent = Messages.findOne({_id: potentialParentId});
              if (potentialParent) {
                // if the potential parent already has a parent, use that parent
                if (potentialParent.parent) {
                  parentId = potentialParent.parent;
                  parent = Messages.findOne({_id: parentId});
                } else {
                  parent = potentialParent;
                  parentId = potentialParentId;                  
                }
                break;
              }
            }
          }

          // no parent, either because no references or because no parent object found
          if (!parent) {
            // parent does not exist, treat as root, search for parent by subject
            // we will accept same subject within a week
            // pick newest such thread
            console.log('specified parent ' + parentId + ' does not exist, looking by subject: ' + obj.subject);
            if (obj.flags.noSubject) {
              console.log("no subject, so can't look by subject; continuing");
              return true;
            }
            var parentFreshness = new Date(new Date(obj.receivedDate) - 86400*28*1000);
            var subjectParent = Messages.findOne({
              subject: obj.subject,
              parent: null,
              threadLastDate: {$gt: parentFreshness}
            }, {sort: {threadLastDate: -1}, limit: 1});

            if (subjectParent) {
              console.log('assigning subject based parent ' + subjectParent._id);
              parent = subjectParent
            } else {
              console.log('subject based parent not found, continuing');
              return true;
            }
          }

          // update parent field of this message
          obj.parent = parent._id;
          obj.thread = parent._id;

          // update children field of parent
          Messages.update({_id: parent._id}, {$push: {children: obj._id}});

          // update threadLastDate of parent if greater
          Messages.update({_id: parent._id, threadLastDate: {$lt: obj.receivedDate}},
            {$set: {
              threadLastDate: obj.receivedDate,
              threadLastMessage: JSON.parse(JSON.stringify(obj))}
            });

          // clear threadFirstDate and threadLastDate
          obj.threadFirstDate = null;
          obj.threadLastDate = null;
          obj.threadLastMessage = null;

          console.log('message was in thread ' + parent.subject);

          return true;
        }
      }
    });

    collectionApi.start();
  });

  var CryptoJS = Meteor.require('crypto-js');

  function authHelper(auth) {
    if (!auth || !auth.email || !auth.name) { return false; }

    var msg = auth.nonce + ":" + auth.email + ":" + auth.name;
    var sign_secret = process.env.SIGN_SECRET || "HM sign secret";
    var hash = CryptoJS.HmacSHA256(msg, sign_secret);

    if (hash == auth.hash) {
      auth.mayPost = true;
      return auth;
    } else {
      return null;
    }
  }

  Meteor.methods({
    authenticate: function (name, email, urlStub) {
      var auth_secret = process.env.AUTH_SECRET || 'HM auth secret';
      console.log("we are asked to authenticate " + email);
      var nonce = CryptoJS.lib.WordArray.random(32);
      var msg = nonce + ":" + email + ":" + name;
      var hash = CryptoJS.HmacSHA256(msg, auth_secret);
      console.log("nonce: " + nonce);
      console.log("msg: " + msg);
      console.log("hash: " + hash);
      console.log(url);

      console.log(email);

      var url = urlStub + '/auth2?email=' + encodeURI(email)
        + '&nonce=' + nonce + '&hash=' + hash + '&name=' + encodeURI(name);
      console.log(url);

      Email.send({
        from: 'guan@hackmanhattan.com',
        to: name + ' <' + email + '>',
        subject: "Blabber Live: authenticate",
        text: "Please click this link to authenticate on the Blabber Live server:\n\n" +
          url
      });

      return true;
    },
    authenticate2: function (name, email, nonce, hash) {
      var sign_secret = process.env.SIGN_SECRET || 'HM sign secret';
      var nonce = CryptoJS.lib.WordArray.random(32);
      var msg = nonce + ":" + email + ":" + name;
      var hash = CryptoJS.HmacSHA256(msg, sign_secret);
      return {
        email: email,
        name: name,
        nonce: nonce.toString(),
        hash: hash.toString()
      };
    },
    authorize: authHelper,
    reply: function (auth, thread, body) {
      var authres = authHelper(auth);
      if (!authres || !authres.mayPost) {
        console.log('not authorized to post');
        return false;
      }

      if (!thread || !body) {
        console.log('not enough data');
        return false;
      }

      console.log("will post as " + auth.name + " <" + auth.email + ">");
      console.log("thread: " + thread);
      console.log("body: " + body);

      var parent = Messages.findOne({_id: thread, parent: null});
      console.log('subject: ' + parent.subject);

      Email.send({
        from: auth.name + " <" + auth.email + ">",
        to: 'blabber@list.hackmanhattan.com',
        subject: 'Re: ' + parent.subject,
        text: body,
        headers: {
          'References': thread,
          'X-Mailer': 'blabberlive/0.1'
        },
      });

      return true;
    },
    post: function (auth, subject, body) {
      var authres = authHelper(auth);
      if (!authres || !authres.mayPost) {
        console.log('not authorized to post');
        return false;
      }

      if (!subject || !body) {
        console.log('not enough data');
        return false;
      }

      console.log("will post as " + auth.name + " <" + auth.email + ">");
      console.log("subject: " + subject);
      console.log("body: " + body);

      Email.send({
        from: auth.name + " <" + auth.email + ">",
        to: 'blabber@list.hackmanhattan.com',
        subject: subject,
        text: body,
        headers: {
          'X-Mailer': 'blabberlive/0.1'
        },
      });

      return true;
    }
  });
}
